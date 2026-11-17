import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, hasTestDb, login, makeInstrument, makeUser, recentSessions, setup } from './helpers.js';

const SECTORS = ['Energy', 'Technology', 'Utilities', 'Healthcare', 'Industrials', 'Financial Services'];

describe.skipIf(!hasTestDb)('portfolio recomendado', () => {
  let ctx;
  let ana;
  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.testNoRateLimit = true;
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    // 26 instrumentos em 6 sectores, ~4 anos de histórico, crescimentos diferentes e alguma oscilação (volatilidade > 0).
    const sessions = recentSessions(1100);
    for (let k = 0; k < 26; k++) {
      const id = await makeInstrument(ctx.pool, `PR${String(k).padStart(2, '0')}.PA`, { closes: [] });
      const g = 1 + 0.0003 * (k + 1);
      const rows = sessions.map((d, i) => {
        const c = (100 * g ** i * (1 + 0.01 * Math.sin(i * (k + 2)))).toFixed(4);
        return [id, d, c, c, c, c, c, 500000, 'teste'];
      });
      await ctx.pool.query('INSERT INTO daily_quotes (instrument_id, session_date, open, high, low, close, adj_close, volume, source) VALUES ?', [rows]);
      await ctx.pool.query('UPDATE instruments SET first_session = ?, last_session = ? WHERE id = ?', [sessions[0], sessions.at(-1), id]);
      await ctx.pool.query("INSERT INTO company_profiles (instrument_id, status, sector) VALUES (?, 'ok', ?)", [id, SECTORS[k % SECTORS.length]]);
      if (k >= 24) await ctx.pool.query('INSERT INTO watchlist_items (user_id, instrument_id) SELECT id, ? FROM users WHERE email = ?', [id, 'ana@exemplo.pt']);
    }
    // Uma sessão provisória (sessão em curso) com um preço absurdo: não pode entrar no cálculo.
    const [[one]] = await ctx.pool.query("SELECT id FROM instruments WHERE symbol = 'PR25.PA'");
    await ctx.pool.query('UPDATE daily_quotes SET provisional = 1, close = 1, adj_close = 1 WHERE instrument_id = ? AND session_date = ?', [one.id, sessions.at(-1)]);
  }, 120_000);
  afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

  it('devolve a carteira de 20, as três listas da última revisão e o rendimento de 24 meses', async () => {
    const res = await ana.get('/recommended-portfolio');
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r).toMatchObject({ universe: 26, windowMonths: 24 });
    expect(r.options).toMatchObject({ positions: 20, keepRank: 40, weeks: 2, maxPerSector: 5 });
    expect(r.positions).toHaveLength(20);
    // Limite por sector e pesos que somam a parte investida.
    const perSector = {};
    for (const p of r.positions) perSector[p.sector] = (perSector[p.sector] ?? 0) + 1;
    expect(Math.max(...Object.values(perSector))).toBeLessThanOrEqual(5);
    expect(r.positions.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(r.summary.invested, 6);
    expect(r.summary.invested).toBeGreaterThan(0.95);
    // A última revisão: datas coerentes e listas que batem certo com a carteira.
    expect(r.review.date <= r.lastDate).toBe(true);
    expect(r.review.next > r.review.date).toBe(true);
    expect(new Date(`${r.review.next}T00:00:00Z`).getUTCDay()).toBe(1); // segunda-feira
    const ids = (list) => list.map((x) => x.instrumentId);
    const after = new Set([...ids(r.review.keep), ...ids(r.review.buy)]);
    expect(after.size).toBe(20);
    if (r.review.executed) expect(new Set(ids(r.positions))).toEqual(after);
    for (const s of r.review.sell) expect(after.has(s.instrumentId)).toBe(false);
    // Rendimento: curva semanal em base 100, com o catálogo ao lado; todos os instrumentos sobem, logo o resultado é positivo.
    expect(r.curve[0].value).toBeCloseTo(100, 6);
    expect(r.curve[0].benchmark).toBeCloseTo(100, 6);
    expect(r.curve.length).toBeGreaterThan(95);
    expect(r.curve.length).toBeLessThan(115);
    expect(r.curve.at(-1).value / 100 - 1).toBeCloseTo(r.summary.returnPct / 100, 6);
    expect(r.summary.returnPct).toBeGreaterThan(0);
    expect(r.summary.benchmarkInstruments).toBe(26);
    expect(r.summary.reviews).toBeGreaterThan(45); // de duas em duas semanas, 24 meses
    expect(r.summary.last12.value).toBeGreaterThan(0);
    // Os que mais crescem estão na carteira; a sessão provisória não conta (o PR25 continua a ser dos melhores).
    const symbols = r.positions.map((p) => p.symbol);
    expect(symbols).toContain('PR25.PA');
    expect(r.positions.find((p) => p.symbol === 'PR25.PA').inWatchlist).toBe(true);
    expect(r.positions.find((p) => p.symbol !== 'PR25.PA' && p.symbol !== 'PR24.PA').inWatchlist).toBe(false);
    expect(r.reviews.length).toBeLessThanOrEqual(12);
    expect(r.reviews[0].date).toBe(r.review.date);
  });

  it('data de início: começa vazia nesse dia e revê logo; fora dos limites, 400', async () => {
    const base = (await ana.get('/recommended-portfolio')).json();
    expect(base.start).toBeNull();
    expect(base.minStart).toBeTruthy();
    // Uma data a meio do histórico (depois de minStart e antes da última sessão).
    const [[row]] = await ctx.pool.query('SELECT session_date AS d FROM daily_quotes WHERE session_date > ? ORDER BY session_date LIMIT 1 OFFSET 100', [base.minStart]);
    const start = typeof row.d === 'string' ? row.d : row.d.toISOString().slice(0, 10);
    const r = (await ana.get(`/recommended-portfolio?start=${start}`)).json();
    expect(r).toMatchObject({ start, firstDate: start, lastDate: base.lastDate, minStart: base.minStart });
    expect(r.curve[0]).toMatchObject({ date: start, value: 100 });
    expect(r.reviews.length).toBeGreaterThan(0);
    // Antes de minStart ou depois da última sessão: recusado.
    const early = await ana.get('/recommended-portfolio?start=2000-01-03');
    expect(early.statusCode).toBe(400);
    expect(early.json().error.code).toBe('START_OUT_OF_RANGE');
    expect((await ana.get(`/recommended-portfolio?start=${base.latestSession}`)).statusCode).toBe(400);
  });

  it('data de início gravada por utilizador e por módulo, até ser alterada', async () => {
    const { minStart, latestSession } = (await ana.get('/recommended-portfolio')).json();
    expect((await ana.get('/portfolio-start-dates')).json().items).toEqual([]);
    expect((await ana.put('/portfolio-start-dates/recommended-portfolio', { start: minStart })).statusCode).toBe(204);
    expect((await ana.get('/portfolio-start-dates')).json().items).toEqual([{ module: 'recommended-portfolio', start: minStart }]);
    // Fora dos limites e módulo desconhecido: recusado, e a data gravada mantém-se.
    expect((await ana.put('/portfolio-start-dates/recommended-portfolio', { start: '2000-01-03' })).statusCode).toBe(400);
    expect((await ana.put('/portfolio-start-dates/recommended-portfolio', { start: latestSession })).statusCode).toBe(400);
    expect((await ana.put('/portfolio-start-dates/outro', { start: minStart })).statusCode).toBe(400);
    expect((await ana.get('/portfolio-start-dates')).json().items[0].start).toBe(minStart);
    // null grava a escolha do período do módulo (sem data), que também se mantém.
    expect((await ana.put('/portfolio-start-dates/recommended-portfolio', { start: null })).statusCode).toBe(204);
    expect((await ana.get('/portfolio-start-dates')).json().items).toEqual([{ module: 'recommended-portfolio', start: null }]);
    await ctx.pool.query('DELETE FROM portfolio_start_dates');
  });

  it('exige sessão', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/recommended-portfolio' })).statusCode).toBe(401);
  });
});
