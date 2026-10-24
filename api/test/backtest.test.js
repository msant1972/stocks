import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { momentum, rollingMean } from '../../shared/momentum.js';
import { backtest } from '../../shared/strategies/a-momentum.js';
import { backtest as bOpus } from '../../shared/strategies/b-opus.js';
import { backtest as cAi } from '../../shared/strategies/c-ai.js';
import { api, hasTestDb, login, makeInstrument, makeUser, recentSessions, setup } from './helpers.js';

/** 'AAAA-MM-DD' recuado n anos (como yearsBefore na API). */
const yearsAgo = (date, n) => { const [y, m, d] = date.split('-').map(Number); const t = new Date(Date.UTC(y - n, m - 1, d)); if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); return t.toISOString().slice(0, 10); };

/** Instrumento com ~3 anos de fechos ondulantes e médias calculadas como o motor de recolha. */
async function wavyInstrument(pool, symbol, phase) {
  const dates = recentSessions(780);
  const closes = dates.map((_, k) => (50 + 15 * Math.sin(k / 23 + phase) + 6 * Math.sin(k / 7) + k * 0.01).toFixed(2));
  const id = await makeInstrument(pool, symbol, { closes, sessions: dates });
  const nums = closes.map(Number);
  const [s10, s125, s200] = [10, 125, 200].map((p) => rollingMean(nums, p));
  const rows = dates.map((d, k) => [s10[k]?.toFixed(6) ?? null, s125[k]?.toFixed(6) ?? null, s200[k]?.toFixed(6) ?? null, id, d]);
  for (const r of rows) await pool.query('UPDATE daily_quotes SET sma10 = ?, sma125 = ?, sma200 = ? WHERE instrument_id = ? AND session_date = ?', r);
  // Máximos, mínimos e volume realistas (a B-Opus usa o ATR e a liquidez).
  await pool.query('UPDATE daily_quotes SET high = close * 1.01, low = close * 0.99, volume = 1000000 WHERE instrument_id = ?', [id]);
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
    expect(body).toMatchObject({ years: 2, budget: 15000, strategy: { id: 'a-momentum', name: 'A-Momentum' } });
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

  it('lista as estratégias e recusa ids desconhecidos', async () => {
    const list = (await ana.get('/strategies')).json();
    expect(list.defaultId).toBe('a-momentum');
    expect(list.items.map((s) => [s.id, s.name, s.available])).toEqual([['a-momentum', 'A-Momentum', true], ['b-opus', 'B-Opus', true], ['c-ai', 'C-AI', true]]);
    expect((await ana.get('/backtest?strategy=c-x')).statusCode).toBe(400);
    expect((await ana.get('/signals?strategy=c-x')).statusCode).toBe(400);
  });

  it('B-Opus: coincide com a página do instrumento (3 anos de histórico, actua nos últimos 2)', async () => {
    const body = (await ana.get('/backtest?strategy=b-opus')).json();
    expect(body.strategy).toMatchObject({ id: 'b-opus', name: 'B-Opus' });
    let traded = 0;
    for (const id of ids) {
      const { lastSession } = (await ana.get(`/instruments/${id}`)).json();
      const { quotes } = (await ana.get(`/instruments/${id}/quotes?from=${yearsAgo(lastSession, 3)}`)).json();
      const last = quotes.at(-1).date;
      const expected = bOpus(quotes, { from: yearsAgo(last, 2) }).summary;
      const row = body.items.find((i) => i.instrumentId === id);
      expect(row).toMatchObject({ closed: expected.closed, wins: expected.wins, total: expected.total, reinforcements: expected.reinforcements });
      expect(row.fromDate >= yearsAgo(last, 2)).toBe(true);
      traded += row.closed;
    }
    expect(traded).toBeGreaterThan(0);
    const sig = (await ana.get('/signals?strategy=b-opus&sessions=20')).json();
    expect(sig.strategy).toBe('b-opus');
    expect(sig.items.every((x) => ['buy', 'sell'].includes(x.side))).toBe(true);
  });

  it('C-AI: coincide com a página do instrumento (3 anos de histórico, actua nos últimos 2)', async () => {
    const body = (await ana.get('/backtest?strategy=c-ai')).json();
    expect(body.strategy).toMatchObject({ id: 'c-ai', name: 'C-AI' });
    let traded = 0;
    for (const id of ids) {
      const { lastSession } = (await ana.get(`/instruments/${id}`)).json();
      const { quotes } = (await ana.get(`/instruments/${id}/quotes?from=${yearsAgo(lastSession, 3)}`)).json();
      const expected = cAi(quotes, { from: yearsAgo(quotes.at(-1).date, 2) }).summary;
      const row = body.items.find((i) => i.instrumentId === id);
      expect(row).toMatchObject({ closed: expected.closed, wins: expected.wins, total: expected.total, reinforcements: expected.reinforcements });
      traded += row.closed + (row.openPosition ? 1 : 0);
    }
    expect(traded).toBeGreaterThan(0);
    const sig = (await ana.get('/signals?strategy=c-ai&sessions=20')).json();
    expect(sig.strategy).toBe('c-ai');
    expect(sig.items.every((x) => ['buy', 'add', 'sell'].includes(x.side))).toBe(true);
  });

  it('WinnersLoosers: agrupa pelos resultados das três estratégias, iguais aos do BackTest', async () => {
    const wl = (await ana.get('/winners-losers')).json();
    expect(wl.strategies.map((x) => x.id)).toEqual(['a-momentum', 'b-opus', 'c-ai']);
    const per = {};
    for (const st of wl.strategies) per[st.id] = (await ana.get(`/backtest?strategy=${st.id}`)).json().items;
    for (const it of wl.items) {
      const values = wl.strategies.map((st) => per[st.id].find((r) => r.instrumentId === it.instrumentId).total);
      expect(Object.values(it.results)).toEqual(values);
      const expected = values.every((v) => v > 0) ? 'gain' : values.every((v) => v < 0) ? 'loss' : 'mixed';
      expect(it.group).toBe(expected);
      expect(it.total).toBeCloseTo(values.reduce((a, b) => a + b, 0), 2);
    }
    expect(wl.counts.total).toBe(wl.items.length);
    expect(wl.counts.gain + wl.counts.loss + wl.counts.mixed).toBe(wl.items.length);
    expect((await ana.get('/winners-losers?scope=watchlist')).json().items.map((i) => i.symbol)).toEqual(
      wl.items.filter((i) => i.symbol === 'ONDA.LS').map((i) => i.symbol),
    );
  });

  it('filtra pela lista do utilizador', async () => {
    const body = (await ana.get('/backtest?scope=watchlist')).json();
    expect(body.items.map((i) => i.symbol)).toEqual(['ONDA.LS']);
    expect((await ana.get('/backtest?scope=x')).statusCode).toBe(400);
  });
});
