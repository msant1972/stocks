import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, hasTestDb, login, makeInstrument, makeUser, recentSessions, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('fases de Wyckoff', () => {
  let ctx;
  let ana;
  const ids = {};
  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.testNoRateLimit = true;
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    const sessions = recentSessions(320);
    const wobble = (i) => 1 + 0.004 * Math.sin(i * 1.7) + 0.002 * Math.sin(i * 0.37);
    const ramp = (i, a, b) => (i <= 180 ? a : i >= 260 ? b : a + ((b - a) * (i - 180)) / 80);
    const shapes = {
      'ACUM.PA': (i) => ramp(i, 100, 62),   // queda e faixa em baixo
      'DIST.PA': (i) => ramp(i, 100, 150),  // subida e faixa em cima
      'SOBE.PA': (i) => 100 * 1.003 ** i,
      'DESCE.PA': (i) => 100 * 0.997 ** i,
      'LADO.PA': () => 100,
    };
    for (const [symbol, level] of Object.entries(shapes)) {
      const id = await makeInstrument(ctx.pool, symbol, { closes: [] });
      const rows = sessions.map((d, i) => { const c = (level(i) * wobble(i)).toFixed(4); return [id, d, c, c, c, c, c, 100000, 'teste']; });
      await ctx.pool.query('INSERT INTO daily_quotes (instrument_id, session_date, open, high, low, close, adj_close, volume, source) VALUES ?', [rows]);
      await ctx.pool.query('UPDATE instruments SET first_session = ?, last_session = ? WHERE id = ?', [sessions[0], sessions.at(-1), id]);
      ids[symbol] = id;
    }
    // Pouco histórico: fica sem fase. E uma sessão provisória absurda, que não pode contar.
    ids['NOVO.PA'] = await makeInstrument(ctx.pool, 'NOVO.PA', { closes: sessions.slice(-100).map(() => '10.00'), sessions: sessions.slice(-100) });
    await ctx.pool.query('UPDATE daily_quotes SET provisional = 1, close = 1, adj_close = 1 WHERE instrument_id = ? AND session_date = ?', [ids['SOBE.PA'], sessions.at(-1)]);
  }, 60_000);
  afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

  it('devolve a fase de cada instrumento com histórico, só com sessões fechadas', async () => {
    const res = await ana.get('/wyckoff');
    expect(res.statusCode).toBe(200);
    const r = res.json();
    const by = new Map(r.items.map((x) => [x.instrumentId, x]));
    expect(by.get(ids['ACUM.PA'])).toMatchObject({ phase: 'accumulation', lateral: true });
    expect(by.get(ids['DIST.PA'])).toMatchObject({ phase: 'distribution', lateral: true });
    expect(by.get(ids['SOBE.PA'])).toMatchObject({ phase: 'markup', lateral: false, rangeSessions: null }); // a sessão provisória (fecho 1) não entrou
    expect(by.get(ids['DESCE.PA']).phase).toBe('markdown');
    expect(by.get(ids['LADO.PA']).phase).toBe('undefined');
    expect(by.has(ids['NOVO.PA'])).toBe(false);
    expect(r.counts).toEqual({ accumulation: 1, markup: 1, distribution: 1, markdown: 1, undefined: 1 });
    expect(r.latestSession).toBe(recentSessions(1)[0]);
    const acc = by.get(ids['ACUM.PA']);
    expect(acc.support).toBeLessThan(acc.resistance);
    expect(acc.position).toBeLessThan(1 / 3);
    expect(acc.rangeSessions).toBeGreaterThanOrEqual(40);
  });

  it('exige sessão', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/wyckoff' })).statusCode).toBe(401);
  });
});
