import { notFound } from '../errors.js';
import { amountCents, cents, fromCents, ratio } from '../money.js';
import { latestQuotes } from './quotes.js';

/**
 * Valorização ao último fecho não ajustado disponível de cada instrumento.
 * - investido: custo total das posições abertas (custo médio ponderado);
 * - não realizado: valor de mercado − custo; realizado: soma dos resultados das vendas;
 * - resultado acumulado: valor total − capital inicial.
 */
export async function portfolioSummary(pool, userId) {
  const [[p]] = await pool.query(
    'SELECT id, currency, initial_capital, cash_balance, created_at FROM portfolios WHERE user_id = ?',
    [userId],
  );
  if (!p) throw notFound('Carteira');
  const [rows] = await pool.query(
    `SELECT pos.instrument_id, i.symbol, i.name, i.exchange, pos.quantity, pos.cost_basis, pos.realized_pnl
       FROM positions pos JOIN instruments i ON i.id = pos.instrument_id
      WHERE pos.portfolio_id = ? ORDER BY i.symbol`,
    [p.id],
  );
  const quotes = await latestQuotes(pool, rows.map((r) => r.instrument_id));

  let invested = 0n;
  let market = 0n;
  let realized = 0n;
  let valuationDate = null;
  const positions = [];
  for (const r of rows) {
    realized += cents(r.realized_pnl);
    if (r.quantity === 0) continue;
    const q = quotes.get(Number(r.instrument_id));
    const cost = cents(r.cost_basis);
    const value = q ? amountCents(r.quantity, q.close) : null;
    invested += cost;
    if (value != null) market += value;
    if (q && (!valuationDate || q.date < valuationDate)) valuationDate = q.date;
    positions.push({
      instrumentId: Number(r.instrument_id), symbol: r.symbol, name: r.name, exchange: r.exchange,
      quantity: r.quantity,
      averageCost: ratio(cost, BigInt(r.quantity) * 100n, 6),
      costBasis: fromCents(cost),
      price: q?.close ?? null, quoteDate: q?.date ?? null,
      marketValue: value == null ? null : fromCents(value),
      unrealizedPnl: value == null ? null : fromCents(value - cost),
      unrealizedPct: value == null || cost === 0n ? null : ratio((value - cost) * 100n, cost, 2),
      realizedPnl: r.realized_pnl,
    });
  }
  const cash = cents(p.cash_balance);
  const initial = cents(p.initial_capital);
  const total = cash + market;
  return {
    currency: p.currency,
    initialCapital: p.initial_capital,
    cashBalance: p.cash_balance,
    invested: fromCents(invested),
    marketValue: fromCents(market),
    totalValue: fromCents(total),
    unrealizedPnl: fromCents(market - invested),
    realizedPnl: fromCents(realized),
    totalPnl: fromCents(total - initial),
    totalPnlPct: ratio((total - initial) * 100n, initial, 2),
    // Data da cotação mais antiga usada na valorização: o valor total não é mais recente do que isto.
    valuationDate,
    positions,
  };
}

/**
 * Evolução diária da carteira: em cada sessão desde a criação, saldo + posições ao fecho não ajustado dessa sessão
 * (ou ao último fecho anterior). Calculada a partir dos movimentos de saldo e das operações, por isso é sempre
 * coerente com o histórico. Valores em número (só para o gráfico).
 */
export async function portfolioHistory(pool, userId) {
  const [[p]] = await pool.query('SELECT id, initial_capital, created_at FROM portfolios WHERE user_id = ?', [userId]);
  if (!p) throw notFound('Carteira');
  const [moves] = await pool.query(
    'SELECT DATE(created_at) AS d, amount FROM cash_movements WHERE portfolio_id = ? ORDER BY created_at, id', [p.id],
  );
  const [trades] = await pool.query(
    `SELECT DATE(requested_at) AS d, instrument_id, side, quantity, amount FROM simulated_trades
      WHERE portfolio_id = ? ORDER BY requested_at, id`, [p.id],
  );
  const start = moves[0]?.d ?? p.created_at.toISOString().slice(0, 10);
  const ids = [...new Set(trades.map((t) => Number(t.instrument_id)))];
  const [sessions] = await pool.query(
    'SELECT DISTINCT session_date AS d FROM daily_quotes WHERE session_date >= ? ORDER BY session_date', [start],
  );
  const closes = new Map(ids.map((id) => [id, []]));
  if (ids.length) {
    const [rows] = await pool.query(
      'SELECT instrument_id, session_date AS d, close FROM daily_quotes WHERE instrument_id IN (?) AND session_date >= ? ORDER BY session_date',
      [ids, start],
    );
    for (const r of rows) closes.get(Number(r.instrument_id)).push([r.d, Number(r.close)]);
  }
  const dates = [...new Set([start, ...sessions.map((s) => s.d)])].sort();
  const toDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
  const qty = new Map();
  const cursor = new Map(ids.map((id) => [id, -1]));
  let cash = 0; let mi = 0; let ti = 0; let invested = 0;
  const points = [];
  for (const d of dates) {
    while (mi < moves.length && toDate(moves[mi].d) <= d) cash += Number(moves[mi++].amount);
    while (ti < trades.length && toDate(trades[ti].d) <= d) {
      const t = trades[ti++]; const id = Number(t.instrument_id);
      qty.set(id, (qty.get(id) ?? 0) + (t.side === 'buy' ? t.quantity : -t.quantity));
      invested += t.side === 'buy' ? Number(t.amount) : -Number(t.amount);
    }
    let market = 0;
    for (const [id, q] of qty) {
      if (!q) continue;
      const series = closes.get(id); let k = cursor.get(id);
      while (k + 1 < series.length && series[k + 1][0] <= d) k += 1;
      cursor.set(id, k);
      if (k >= 0) market += q * series[k][1];
    }
    const r2 = (v) => Math.round(v * 100) / 100;
    points.push({ date: d, cash: r2(cash), marketValue: r2(market), total: r2(cash + market), netInvested: r2(invested) });
  }
  return { initialCapital: Number(p.initial_capital), points };
}
