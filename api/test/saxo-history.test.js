import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { snapshotValues, takeDueSnapshots } from '../src/saxo/history.js';
import { encryptSecret } from '../src/secrets.js';
import { api, hasTestDb, login, makeInstrument, makeUser, setup, TEST_SECRET_KEY } from './helpers.js';

describe('valor da conta SAXO', () => {
  it('usa o valor total da SAXO; o saldo inclui o que está por liquidar', () => {
    expect(snapshotValues({ TotalValue: 990680.08, CashBalance: 328491.8, TransactionsNotBooked: -29518.12, NonMarginPositionsValue: 691706.4, Currency: 'EUR' }))
      .toEqual({ total: 990680.08, cash: 298973.68, positions: 691706.4, currency: 'EUR' });
    expect(snapshotValues({ TotalValue: 1000, CashBalance: 1000 })).toEqual({ total: 1000, cash: 1000, positions: null, currency: 'EUR' });
    expect(snapshotValues({})).toBeNull();
    expect(snapshotValues(null)).toBeNull();
  });
});

describe.skipIf(!hasTestDb)('evolução da carteira', () => {
  let ctx;
  let ana;
  let userId;
  let calls = 0;
  let total = 1000;
  const SESSION = '2026-11-05';

  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.saxo.fetchImpl = async () => { calls += 1; return new Response(JSON.stringify({ TotalValue: total, CashBalance: 400, NonMarginPositionsValue: total - 400 }), { status: 200 }); };
    userId = await makeUser(ctx.pool, 'hist@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'hist@exemplo.pt'));
    await makeInstrument(ctx.pool, 'GALP.LS', { closes: ['10'], sessions: [SESSION] });
  });
  beforeEach(async () => {
    calls = 0;
    total = 1000;
    for (const t of ['saxo_account_history', 'job_runs', 'user_integration_tokens']) await ctx.pool.query(`DELETE FROM ${t}`);
    await ctx.pool.query(
      `INSERT INTO user_integration_tokens (user_id, provider, token_enc, environment, auth_kind, refresh_token_enc, expires_at, refresh_expires_at)
       VALUES (?, 'saxo', ?, 'sim', 'oauth', ?, NOW(3) + INTERVAL 20 MINUTE, NOW(3) + INTERVAL 40 MINUTE)`,
      [userId, encryptSecret(TEST_SECRET_KEY, 'tok'), encryptSecret(TEST_SECRET_KEY, 'ref')],
    );
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });
  const dailyDone = (at = '2026-11-05 19:01:00') => ctx.pool.query("INSERT INTO job_runs (kind, status, started_at, finished_at) VALUES ('fetch_update', 'done', ?, ?)", [at, at]);

  it('sem a recolha diária dessa sessão não guarda nada', async () => {
    expect(await takeDueSnapshots(ctx.pool, ctx.cfg)).toBe(0);
    await dailyDone('2026-11-04 19:01:00');
    expect(await takeDueSnapshots(ctx.pool, ctx.cfg)).toBe(0);
    expect(calls).toBe(0);
  });

  it('guarda uma leitura por sessão e o histórico devolve-a', async () => {
    await dailyDone();
    expect(await takeDueSnapshots(ctx.pool, ctx.cfg)).toBe(1);
    total = 2000;
    expect(await takeDueSnapshots(ctx.pool, ctx.cfg)).toBe(0); // já tem esta sessão: nem pergunta à SAXO
    expect(calls).toBe(1);
    expect((await ana.get('/saxo/portfolio/history')).json()).toEqual({
      currency: 'EUR', initialCapital: 1000000, points: [{ date: SESSION, total: 1000, cash: 400, positions: 600 }],
    });
  });

  it('com a ligação recusada não tenta', async () => {
    await dailyDone();
    await ctx.pool.query('UPDATE user_integration_tokens SET rejected_at = NOW(3)');
    expect(await takeDueSnapshots(ctx.pool, ctx.cfg)).toBe(0);
    expect(calls).toBe(0);
  });

  it('sem leituras, o histórico vem vazio', async () => {
    expect((await ana.get('/saxo/portfolio/history')).json()).toEqual({ currency: 'EUR', initialCapital: 1000000, points: [] });
  });
});
