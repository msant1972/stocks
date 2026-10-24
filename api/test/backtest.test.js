import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { momentum, rollingMean } from '../../shared/momentum.js';
import { backtest } from '../../shared/strategy.js';
import { api, hasTestDb, login, makeInstrument, makeUser, recentSessions, setup } from './helpers.js';

/** Instrumento com ~3 anos de fechos ondulantes e médias calculadas como o motor de recolha. */
async function wavyInstrument(pool, symbol, phase) {
  const dates = recentSessions(780);
  const closes = dates.map((_, k) => (50 + 15 * Math.sin(k / 23 + phase) + 6 * Math.sin(k / 7) + k * 0.01).toFixed(2));
  const id = await makeInstrument(pool, symbol, { closes, sessions: dates });
  const nums = closes.map(Number);
  const [s10, s125, s200] = [10, 125, 200].map((p) => rollingMean(nums, p));
  const rows = dates.map((d, k) => [s10[k]?.toFixed(6) ?? null, s125[k]?.toFixed(6) ?? null, s200[k]?.toFixed(6) ?? null, id, d]);
  for (const r of rows) await pool.query('UPDATE daily_quotes SET sma10 = ?, sma125 = ?, sma200 = ? WHERE instrument_id = ? AND session_date = ?', r);
  return id;
}

describe.skipIf(!hasTestDb)('BackTest: estratégia em todos os instrumentos', () => {
  let ctx;
  let ana;
  let ids;
  beforeAll(async () => {
    ctx = await setup();
    const uid = await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    ids = [await wavyInstrument(ctx.pool, 'ONDA.LS', 0), await wavyInstrument(ctx.pool, 'MARE.LS', 2)];
    await makeInstrument(ctx.pool, 'CURTO.LS', { closes: ['5', '5', '5'] }); // sem médias: sem operações
    await ctx.pool.query('INSERT INTO watchlist_items (user_id, instrument_id) VALUES (?, ?)', [uid, ids[0]]);
  }, 120_000);
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('coincide com «Aplicar estratégia» sobre os mesmos 2 anos que a página do instrumento carrega', async () => {
    const res = await ana.get('/backtest');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ years: 2, budget: 15000 });
    expect(body.items.map((i) => i.symbol).sort()).toEqual(['CURTO.LS', 'MARE.LS', 'ONDA.LS']);
    for (const id of ids) {
      const { quotes } = (await ana.get(`/instruments/${id}/quotes`)).json();
      const expected = backtest(quotes, momentum(quotes)).summary;
      const row = body.items.find((i) => i.instrumentId === id);
      expect(row.sessions).toBe(quotes.length);
      expect(row.sessions).toBeLessThan(780); // só os últimos 2 anos, não os 3 guardados
      expect(row).toMatchObject({
        closed: expected.closed, wins: expected.wins, reinforcements: expected.reinforcements,
        peakCost: expected.peakCost, realized: expected.realized, total: expected.total,
      });
      expect(row.closed).toBeGreaterThan(0);
      expect(row.totalPct).toBeCloseTo(expected.totalPct, 2);
      expect(row.buyHoldPnl).toBe(expected.buyHold.pnl);
    }
    expect(body.items.find((i) => i.symbol === 'CURTO.LS')).toMatchObject({ closed: 0, total: 0, fromDate: null, buyHoldPnl: null });
  });

  it('filtra pela lista do utilizador', async () => {
    const body = (await ana.get('/backtest?scope=watchlist')).json();
    expect(body.items.map((i) => i.symbol)).toEqual(['ONDA.LS']);
    expect((await ana.get('/backtest?scope=x')).statusCode).toBe(400);
  });
});
