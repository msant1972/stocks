import { audit, withTransaction } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { amountCents, cents, fromCents, roundDiv, toScaled } from '../money.js';
import { ageInDays } from './quotes.js';

/**
 * Regras da simulação (arquitectura, secção 4.2):
 * - preço = último fecho diário não ajustado disponível;
 * - compra limitada ao saldo; venda limitada à quantidade detida; sem posições curtas;
 * - saldo, posição, operação e movimento de saldo actualizados numa só transacção;
 * - a mesma chave de idempotência nunca cria duas operações.
 */

async function lockPortfolio(conn, userId) {
  const [[p]] = await conn.query(
    'SELECT id, currency, cash_balance FROM portfolios WHERE user_id = ? FOR UPDATE',
    [userId],
  );
  if (!p) throw notFound('Carteira');
  return p;
}

/** Instrumento negociável e respectivo último fecho, ou erro explicativo. */
async function tradableQuote(conn, instrumentId, currency, maxQuoteAgeDays) {
  const [[inst]] = await conn.query(
    'SELECT id, symbol, status, currency, last_session FROM instruments WHERE id = ?',
    [instrumentId],
  );
  if (!inst) throw notFound('Instrumento');
  if (inst.status !== 'active') {
    throw new AppError(409, 'INSTRUMENT_NOT_ACTIVE', 'o instrumento ainda não está activo ou é inválido');
  }
  if (inst.currency !== currency) {
    throw new AppError(409, 'CURRENCY_MISMATCH', `só são simuláveis instrumentos em ${currency}`);
  }
  const [[q]] = await conn.query(
    'SELECT session_date, close FROM daily_quotes WHERE instrument_id = ? ORDER BY session_date DESC LIMIT 1',
    [instrumentId],
  );
  if (!q) throw new AppError(409, 'NO_QUOTE', 'não há cotações disponíveis para este instrumento');
  const age = ageInDays(q.session_date);
  if (age > maxQuoteAgeDays) {
    throw new AppError(409, 'STALE_QUOTE', `a última cotação (${q.session_date}) tem mais de ${maxQuoteAgeDays} dias`, {
      quoteDate: q.session_date,
    });
  }
  return { symbol: inst.symbol, price: q.close, quoteDate: q.session_date };
}

async function currentPosition(conn, portfolioId, instrumentId, lock) {
  const [[pos]] = await conn.query(
    `SELECT quantity, cost_basis, realized_pnl FROM positions
      WHERE portfolio_id = ? AND instrument_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [portfolioId, instrumentId],
  );
  return pos ?? { quantity: 0, cost_basis: '0.00', realized_pnl: '0.00' };
}

/** Cálculo puro de uma operação, partilhado pela pré-visualização e pela execução. */
export function computeTrade({ side, quantity, price, cash, position }) {
  const amount = amountCents(quantity, price);
  const cashC = cents(cash);
  const heldQty = BigInt(position.quantity);
  const costC = cents(position.cost_basis);
  if (side === 'buy') {
    return {
      amount, cashAfter: cashC - amount, quantityAfter: heldQty + BigInt(quantity),
      costAfter: costC + amount, realized: null,
      error: amount > cashC ? { code: 'INSUFFICIENT_FUNDS', message: 'saldo virtual insuficiente' } : null,
    };
  }
  const q = BigInt(quantity);
  if (q > heldQty) {
    return {
      amount, cashAfter: cashC + amount, quantityAfter: heldQty - q, costAfter: costC, realized: null,
      error: { code: 'INSUFFICIENT_QUANTITY', message: `só detém ${heldQty} unidades` },
    };
  }
  // Custo médio ponderado: retira-se a fracção proporcional do custo total; a última unidade leva o resto.
  const costRemoved = q === heldQty ? costC : roundDiv(costC * q, heldQty);
  return {
    amount, cashAfter: cashC + amount, quantityAfter: heldQty - q,
    costAfter: costC - costRemoved, realized: amount - costRemoved, error: null,
  };
}

export async function previewTrade(pool, userId, { instrumentId, side, quantity }, cfg) {
  const conn = await pool.getConnection();
  try {
    const [[p]] = await conn.query('SELECT id, currency, cash_balance FROM portfolios WHERE user_id = ?', [userId]);
    if (!p) throw notFound('Carteira');
    const quote = await tradableQuote(conn, instrumentId, p.currency, cfg.maxQuoteAgeDays);
    const position = await currentPosition(conn, p.id, instrumentId, false);
    const r = computeTrade({ side, quantity, price: quote.price, cash: p.cash_balance, position });
    return {
      instrumentId, side, quantity, currency: p.currency,
      price: quote.price, quoteDate: quote.quoteDate,
      amount: fromCents(r.amount), cashAfter: fromCents(r.cashAfter),
      quantityAfter: Number(r.quantityAfter), error: r.error,
    };
  } finally {
    conn.release();
  }
}

export async function executeTrade(pool, userId, req, cfg) {
  const { instrumentId, side, quantity, idempotencyKey, expectedPrice, expectedQuoteDate } = req;
  return withTransaction(pool, async (conn) => {
    // O bloqueio da carteira serializa as operações do mesmo utilizador, incluindo repetições do mesmo pedido.
    const p = await lockPortfolio(conn, userId);

    const [[prior]] = await conn.query(
      'SELECT id, instrument_id, side, quantity FROM simulated_trades WHERE portfolio_id = ? AND idempotency_key = ?',
      [p.id, idempotencyKey],
    );
    if (prior) {
      if (Number(prior.instrument_id) !== instrumentId || prior.side !== side || prior.quantity !== quantity) {
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'a chave de idempotência já foi usada noutro pedido');
      }
      return { trade: await getTrade(conn, userId, prior.id), replayed: true };
    }

    const quote = await tradableQuote(conn, instrumentId, p.currency, cfg.maxQuoteAgeDays);
    const priceChanged = expectedPrice != null && toScaled(expectedPrice, 6) !== toScaled(quote.price, 6);
    const dateChanged = expectedQuoteDate != null && expectedQuoteDate !== quote.quoteDate;
    if (priceChanged || dateChanged) {
      throw new AppError(409, 'PRICE_CHANGED', 'a cotação mudou desde a pré-visualização; confirme de novo', {
        price: quote.price, quoteDate: quote.quoteDate,
      });
    }

    const position = await currentPosition(conn, p.id, instrumentId, true);
    const r = computeTrade({ side, quantity, price: quote.price, cash: p.cash_balance, position });
    if (r.error) throw new AppError(422, r.error.code, r.error.message);

    const amount = fromCents(r.amount);
    const [t] = await conn.query(
      `INSERT INTO simulated_trades
         (portfolio_id, instrument_id, side, quantity, price, amount, currency, quote_date, realized_pnl, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, instrumentId, side, quantity, quote.price, amount, p.currency, quote.quoteDate,
        r.realized == null ? null : fromCents(r.realized), idempotencyKey],
    );
    await conn.query(
      'INSERT INTO cash_movements (portfolio_id, kind, amount, trade_id) VALUES (?, ?, ?, ?)',
      [p.id, side, side === 'buy' ? `-${amount}` : amount, t.insertId],
    );
    await conn.query('UPDATE portfolios SET cash_balance = ? WHERE id = ?', [fromCents(r.cashAfter), p.id]);
    await conn.query(
      `INSERT INTO positions (portfolio_id, instrument_id, quantity, cost_basis, realized_pnl)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), cost_basis = VALUES(cost_basis),
                               realized_pnl = VALUES(realized_pnl)`,
      [p.id, instrumentId, Number(r.quantityAfter), fromCents(r.costAfter),
        fromCents(cents(position.realized_pnl) + (r.realized ?? 0n))],
    );
    await audit(conn, userId, `trade.${side}`, 'simulated_trade', t.insertId, {
      instrumentId, quantity, price: quote.price, quoteDate: quote.quoteDate, amount,
    });
    return { trade: await getTrade(conn, userId, t.insertId), replayed: false };
  });
}

const TRADE_SELECT = `
  SELECT t.id, t.instrument_id, i.symbol, i.name, t.side, t.quantity, t.price, t.amount, t.currency,
         t.quote_date, t.realized_pnl, t.requested_at
    FROM simulated_trades t
    JOIN portfolios p ON p.id = t.portfolio_id
    JOIN instruments i ON i.id = t.instrument_id`;

export function mapTrade(r) {
  return {
    id: Number(r.id), instrumentId: Number(r.instrument_id), symbol: r.symbol, name: r.name,
    side: r.side, quantity: r.quantity, price: r.price, amount: r.amount, currency: r.currency,
    quoteDate: r.quote_date, realizedPnl: r.realized_pnl, requestedAt: r.requested_at.toISOString(),
  };
}

async function getTrade(conn, userId, tradeId) {
  const [[r]] = await conn.query(`${TRADE_SELECT} WHERE p.user_id = ? AND t.id = ?`, [userId, tradeId]);
  return mapTrade(r);
}

export async function listTrades(pool, userId, { instrumentId, side, from, to, limit, offset }) {
  const where = ['p.user_id = ?'];
  const args = [userId];
  if (instrumentId) { where.push('t.instrument_id = ?'); args.push(instrumentId); }
  if (side) { where.push('t.side = ?'); args.push(side); }
  if (from) { where.push('t.requested_at >= ?'); args.push(`${from} 00:00:00`); }
  if (to) { where.push('t.requested_at < ? + INTERVAL 1 DAY'); args.push(`${to} 00:00:00`); }
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM simulated_trades t JOIN portfolios p ON p.id = t.portfolio_id WHERE ${where.join(' AND ')}`,
    args,
  );
  const [rows] = await pool.query(
    `${TRADE_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.requested_at DESC, t.id DESC LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );
  return { items: rows.map(mapTrade), total: Number(total) };
}
