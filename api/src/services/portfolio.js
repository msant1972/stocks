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
