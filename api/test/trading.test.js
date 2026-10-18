import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, hasTestDb, login, makeInstrument, makeUser, recentSessions, setup } from './helpers.js';

let keySeq = 0;
const key = () => `teste-${Date.now()}-${++keySeq}`;

describe.skipIf(!hasTestDb)('carteira e operações simuladas', () => {
  let ctx;
  let ana;
  let galp;
  beforeAll(async () => {
    ctx = await setup();
  });
  beforeEach(async () => {
    await ctx.pool.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['cash_movements', 'simulated_trades', 'positions', 'portfolios', 'sessions', 'users', 'daily_quotes', 'instruments', 'audit_log']) {
      await ctx.pool.query(`TRUNCATE TABLE ${t}`);
    }
    await ctx.pool.query('SET FOREIGN_KEY_CHECKS = 1');
    await makeUser(ctx.pool, 'ana@exemplo.pt', '1000.00');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    galp = await makeInstrument(ctx.pool, 'GALP.LS', { closes: ['15.00', '16.00'] });
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  const buy = (quantity, extra = {}) => ana.post('/simulated-trades', { instrumentId: galp, side: 'buy', quantity, idempotencyKey: key(), ...extra });
  const sell = (quantity, extra = {}) => ana.post('/simulated-trades', { instrumentId: galp, side: 'sell', quantity, idempotencyKey: key(), ...extra });

  it('começa com o capital inicial', async () => {
    const p = (await ana.get('/portfolio')).json();
    expect(p).toMatchObject({ currency: 'EUR', initialCapital: '1000.00', cashBalance: '1000.00', totalValue: '1000.00', totalPnl: '0.00', positions: [] });
  });

  it('pré-visualiza ao último fecho não ajustado, com a data da cotação', async () => {
    const res = await ana.get(`/simulated-trades/preview?instrumentId=${galp}&side=buy&quantity=10`);
    expect(res.json()).toMatchObject({ price: '16.000000', quoteDate: recentSessions(1)[0], amount: '160.00', cashAfter: '840.00', error: null });
  });

  it('compra e venda actualizam saldo, posição e resultados', async () => {
    const b = await buy(30);
    expect(b.statusCode).toBe(201);
    expect(b.json().trade).toMatchObject({ side: 'buy', quantity: 30, price: '16.000000', amount: '480.00', currency: 'EUR' });

    let p = (await ana.get('/portfolio')).json();
    expect(p.cashBalance).toBe('520.00');
    expect(p.positions[0]).toMatchObject({ quantity: 30, costBasis: '480.00', averageCost: '16.000000', marketValue: '480.00', unrealizedPnl: '0.00' });

    // O preço sobe para 20: valorização não realizada de 120.
    await ctx.pool.query("UPDATE daily_quotes SET close = '20.000000' WHERE instrument_id = ? AND session_date = ?", [galp, recentSessions(1)[0]]);
    p = (await ana.get('/portfolio')).json();
    expect(p.unrealizedPnl).toBe('120.00');
    expect(p.totalValue).toBe('1120.00');

    const s = await sell(10);
    expect(s.statusCode).toBe(201);
    expect(s.json().trade.realizedPnl).toBe('40.00');
    p = (await ana.get('/portfolio')).json();
    expect(p).toMatchObject({ cashBalance: '720.00', invested: '320.00', realizedPnl: '40.00', totalPnl: '120.00' });

    const list = (await ana.get('/simulated-trades')).json();
    expect(list.total).toBe(2);
    expect(list.items[0].side).toBe('sell');
  });

  it('recusa compra acima do saldo e venda acima da quantidade detida', async () => {
    const b = await buy(63); // 1008.00 > 1000.00
    expect(b.statusCode).toBe(422);
    expect(b.json().error.code).toBe('INSUFFICIENT_FUNDS');
    const s = await sell(1);
    expect(s.statusCode).toBe(422);
    expect(s.json().error.code).toBe('INSUFFICIENT_QUANTITY');
    const [[{ n }]] = await ctx.pool.query('SELECT COUNT(*) AS n FROM simulated_trades');
    expect(Number(n)).toBe(0);
  });

  it('repetir o pedido com a mesma chave não duplica a operação', async () => {
    const idempotencyKey = key();
    const first = await ana.post('/simulated-trades', { instrumentId: galp, side: 'buy', quantity: 5, idempotencyKey });
    const again = await ana.post('/simulated-trades', { instrumentId: galp, side: 'buy', quantity: 5, idempotencyKey });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ replayed: true, trade: { id: first.json().trade.id } });
    expect((await ana.get('/portfolio')).json().cashBalance).toBe('920.00');
    const conflict = await ana.post('/simulated-trades', { instrumentId: galp, side: 'buy', quantity: 6, idempotencyKey });
    expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('duas compras concorrentes não gastam o mesmo saldo', async () => {
    // Cada compra custa 800.00; o saldo de 1000.00 só chega para uma.
    const results = await Promise.all([buy(50), buy(50), buy(50)]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 422, 422]);
    const p = (await ana.get('/portfolio')).json();
    expect(p.cashBalance).toBe('200.00');
    expect(p.positions[0].quantity).toBe(50);
  });

  it('pede nova confirmação se a cotação mudou desde a pré-visualização', async () => {
    const res = await buy(1, { expectedPrice: '15.00' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'PRICE_CHANGED', details: { price: '16.000000' } });
    expect((await buy(1, { expectedPrice: '16.00', expectedQuoteDate: recentSessions(1)[0] })).statusCode).toBe(201);
  });

  it('recusa instrumentos pendentes, noutra moeda ou com cotação desactualizada', async () => {
    const pending = await makeInstrument(ctx.pool, 'NOVO.LS', { status: 'pending', closes: [] });
    const usd = await makeInstrument(ctx.pool, 'AAPL', { currency: 'USD' });
    const old = await makeInstrument(ctx.pool, 'VELHO.LS', { closes: ['1.00'], sessions: ['2026-01-05'] });
    const attempt = (instrumentId) => ana.post('/simulated-trades', { instrumentId, side: 'buy', quantity: 1, idempotencyKey: key() });
    expect((await attempt(pending)).json().error.code).toBe('INSTRUMENT_NOT_ACTIVE');
    expect((await attempt(usd)).json().error.code).toBe('CURRENCY_MISMATCH');
    expect((await attempt(old)).json().error.code).toBe('STALE_QUOTE');
    expect((await attempt(424242)).statusCode).toBe(404);
  });

  it('cada utilizador só vê as suas operações e carteira', async () => {
    await buy(1);
    await makeUser(ctx.pool, 'rui@exemplo.pt', '500.00');
    const rui = api(ctx.app, await login(ctx.app, 'rui@exemplo.pt'));
    expect((await rui.get('/simulated-trades')).json().total).toBe(0);
    expect((await rui.get('/portfolio')).json().cashBalance).toBe('500.00');
  });

  it('valida o pedido', async () => {
    const res = await ana.post('/simulated-trades', { instrumentId: galp, side: 'buy', quantity: 0, idempotencyKey: 'x' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});
