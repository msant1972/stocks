import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, hasTestDb, login, makeInstrument, makeUser, recentSessions, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('rotação por momentum relativo', () => {
  let ctx;
  let ana;
  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.testNoRateLimit = true;
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    // 12 instrumentos com histórico de ~4 anos e crescimentos diferentes (volume alto: liquidez de sobra).
    const sessions = recentSessions(1100);
    for (let k = 0; k < 12; k++) {
      const g = 1 + 0.0004 * (k + 1);
      const closes = sessions.map((_, i) => (100 * g ** i).toFixed(4));
      const id = await makeInstrument(ctx.pool, `ROT${k}.PA`, { closes, sessions });
      await ctx.pool.query('UPDATE daily_quotes SET volume = 5000000 WHERE instrument_id = ?', [id]);
      if (k < 3) await ctx.pool.query('INSERT INTO watchlist_items (user_id, instrument_id) SELECT id, ? FROM users WHERE email = ?', [id, 'ana@exemplo.pt']);
    }
  }, 180_000); // 12 instrumentos × 1 100 sessões, linha a linha: demora
  afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

  it('simula a rotação do catálogo: resumo, curva, operações e revisão seguinte', async () => {
    const res = await ana.get('/strategies/rotation');
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r).toMatchObject({ period: 'recent', scope: 'all', universe: 12 });
    expect(r.options).toMatchObject({ positions: 10, keepRank: 20, lookback: 252, skip: 21 });
    expect(r.summary.rebalances).toBeGreaterThan(18);
    expect(r.summary.peakCost).toBeGreaterThan(0);
    expect(r.summary.peakCost).toBeLessThanOrEqual(10 * 15000);
    expect(r.summary.net).toBeCloseTo(r.summary.total - r.summary.costs, 1);
    expect(r.summary.buyHold.instruments).toBe(12);
    expect(r.curve.length).toBeGreaterThan(90);
    expect(r.curve.length).toBeLessThan(120); // uma sessão por semana
    expect(r.open.length).toBeLessThanOrEqual(10);
    expect(r.next.eligible).toBe(12);
    expect(r.next.top[0].symbol).toBe('ROT11.PA'); // o de maior crescimento é o 1.º do ranking
    expect(r.next.top[0].rank).toBe(1);
    expect(r.firstDate < r.lastDate).toBe(true);
  });

  it('período de verificação, 5 posições e a minha lista', async () => {
    const v = (await ana.get('/strategies/rotation?period=verification&positions=5')).json();
    expect(v).toMatchObject({ period: 'verification', universe: 12 });
    expect(v.options).toMatchObject({ positions: 5, keepRank: 10 });
    expect(v.lastDate < (await ana.get('/strategies/rotation')).json().lastDate).toBe(true);
    const mine = (await ana.get('/strategies/rotation?scope=watchlist&positions=5')).json();
    expect(mine).toMatchObject({ scope: 'watchlist', universe: 3 });
    expect(mine.open.length).toBeLessThanOrEqual(3);
  });

  it('recusa valores fora do esperado e exige sessão', async () => {
    expect((await ana.get('/strategies/rotation?positions=7')).statusCode).toBe(400);
    expect((await ana.get('/strategies/rotation?period=x')).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/strategies/rotation' })).statusCode).toBe(401);
  });
});

describe.skipIf(!hasTestDb)('valor e qualidade', () => {
  let ctx;
  let ana;
  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.testNoRateLimit = true;
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    const rows = [
      ['BOA.PA', 8, 200, 0.25, 0.2, 20], ['MEDIA.PA', 15, 100, 0.12, 0.08, 80], ['MA.PA', 40, 10, 0.03, 0.01, 250], ['POUCOS.PA', null, null, null, 0.1, 40],
    ];
    for (const [symbol, pe, fcf, roe, margin, debt] of rows) {
      const id = await makeInstrument(ctx.pool, symbol, { closes: ['10', '10'] });
      await ctx.pool.query(
        `INSERT INTO company_profiles (instrument_id, status, trailing_pe, market_cap, free_cashflow, return_on_equity, profit_margin, debt_to_equity, currency, financial_currency, fetched_at)
         VALUES (?, 'ok', ?, 1000, ?, ?, ?, ?, 'EUR', 'EUR', NOW(3))`, [id, pe, fcf, roe, margin, debt],
      );
      if (symbol !== 'MA.PA') await ctx.pool.query('INSERT INTO watchlist_items (user_id, instrument_id) SELECT id, ? FROM users WHERE email = ?', [id, 'ana@exemplo.pt']);
    }
  });
  afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

  it('ordena pelos fundamentais; sem indicadores suficientes fica de fora; a lista restringe o universo', async () => {
    const r = (await ana.get('/strategies/fundamentals')).json();
    expect(r).toMatchObject({ universe: 4, scored: 3 });
    expect(r.items.map((x) => x.symbol)).toEqual(['BOA.PA', 'MEDIA.PA', 'MA.PA']);
    expect(r.items[0]).toMatchObject({ rank: 1, inMomentum: false });
    expect(r.items[0].score).toBeGreaterThan(r.items[2].score);
    expect(r.items[0].earningsYield).toBeCloseTo(0.125);
    const mine = (await ana.get('/strategies/fundamentals?scope=watchlist')).json();
    expect(mine.universe).toBe(3);
    expect(mine.items.map((x) => x.symbol)).toEqual(['BOA.PA', 'MEDIA.PA']);
    expect((await ana.get('/strategies/fundamentals?limit=2')).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/strategies/fundamentals' })).statusCode).toBe(401);
  });
});
