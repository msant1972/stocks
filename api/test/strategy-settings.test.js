import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser } from '../src/services/users.js';
import { api, enableMfa, FAST_HASH, hasTestDb, login, makeUser, PASSWORD, setup } from './helpers.js';

const ALL = ['a-momentum', 'b-opus', 'c-ai', 'd-reversao', 'e-ondas'];

describe.skipIf(!hasTestDb)('estratégias ligadas e desligadas (Definições)', () => {
  let ctx;
  let admin;
  let ana;
  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.testNoRateLimit = true;
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    await enableMfa(ctx.pool, await createUser(ctx.pool, { email: 'adm@exemplo.pt', name: 'Admin', password: PASSWORD, isAdmin: true }, FAST_HASH));
    admin = api(ctx.app, await login(ctx.app, 'adm@exemplo.pt'));
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  const enabledOf = async () => (await ana.get('/strategies')).json().items.filter((s) => s.enabled).map((s) => s.id);

  it('começam todas ligadas; só administradores alteram', async () => {
    expect(await enabledOf()).toEqual(ALL);
    expect((await ana.put('/strategies/b-opus/enabled', { enabled: false })).statusCode).toBe(403);
    expect((await admin.put('/strategies/x-y/enabled', { enabled: false })).statusCode).toBe(400);
  });

  it('desligar tira a estratégia de todos os módulos', async () => {
    const res = await admin.put('/strategies/b-opus/enabled', { enabled: false });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.find((s) => s.id === 'b-opus').enabled).toBe(false);
    expect(await enabledOf()).toEqual(['a-momentum', 'c-ai', 'd-reversao', 'e-ondas']);
    // Sinais e BackTest recusam a desligada, e aceitam as outras.
    expect((await ana.get('/signals?strategy=b-opus')).json().error.code).toBe('STRATEGY_DISABLED');
    expect((await ana.get('/backtest?strategy=b-opus')).statusCode).toBe(409);
    expect((await ana.get('/signals?strategy=c-ai')).statusCode).toBe(200);
    // Comparar, WinnersLoosers e a melhor estratégia só têm as ligadas.
    const cmp = (await ana.get('/strategies/compare')).json();
    expect(cmp.items.map((s) => s.id)).toEqual(['a-momentum', 'c-ai', 'd-reversao', 'e-ondas']);
    expect((await ana.get('/winners-losers')).json().strategies.map((s) => s.id)).toEqual(['a-momentum', 'c-ai', 'd-reversao', 'e-ondas']);
    expect((await ana.get('/signals/watchlist')).json().items.every((i) => i.strategy !== 'b-opus')).toBe(true);
    // Automação: a desligada nas Definições não se liga e aparece marcada.
    expect((await ana.put('/saxo/automation/strategies/b-opus', { enabled: true })).statusCode).toBe(409);
    const auto = (await ana.get('/saxo/automation')).json();
    expect(auto.strategies.find((s) => s.id === 'b-opus')).toMatchObject({ enabled: false, disabledInSettings: true });
  });

  it('a estratégia por omissão passa à primeira ligada quando a A-Momentum se desliga', async () => {
    expect((await ana.get('/strategies')).json().defaultId).toBe('a-momentum');
    await admin.put('/strategies/a-momentum/enabled', { enabled: false });
    expect((await ana.get('/strategies')).json().defaultId).toBe('c-ai');
    expect((await ana.get('/backtest')).json().strategy.id).toBe('c-ai');
    expect((await ana.get('/signals')).json().strategy).toBe('c-ai');
  });

  it('tem de ficar pelo menos uma ligada, e ligar volta a pô-la nos resultados', async () => {
    await admin.put('/strategies/c-ai/enabled', { enabled: false });
    await admin.put('/strategies/d-reversao/enabled', { enabled: false });
    const last = await admin.put('/strategies/e-ondas/enabled', { enabled: false });
    expect(last.statusCode).toBe(409);
    expect(last.json().error.code).toBe('LAST_STRATEGY');
    expect(await enabledOf()).toEqual(['e-ondas']);
    for (const id of ['a-momentum', 'b-opus', 'c-ai', 'd-reversao']) await admin.put(`/strategies/${id}/enabled`, { enabled: true });
    expect(await enabledOf()).toEqual(ALL);
    expect((await ana.get('/backtest?strategy=b-opus')).statusCode).toBe(200);
    const [rows] = await ctx.pool.query("SELECT COUNT(*) n FROM audit_log WHERE action = 'admin.strategy_toggle'");
    expect(Number(rows[0].n)).toBeGreaterThan(5);
  });
});
