import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, hasTestDb, login, makeInstrument, makeUser, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('regras de alerta', () => {
  let ctx;
  let ana;
  let rui;
  let galp;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    await makeUser(ctx.pool, 'rui@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    rui = api(ctx.app, await login(ctx.app, 'rui@exemplo.pt'));
    galp = await makeInstrument(ctx.pool, 'GALP.LS');
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('cria, lista, edita e apaga regras', async () => {
    const created = await ana.post('/alerts', { instrumentId: galp, kind: 'close_above', threshold: '150.5' });
    expect(created.statusCode).toBe(201);
    const rule = created.json();
    expect(rule).toMatchObject({ symbol: 'GALP.LS', kind: 'close_above', threshold: '150.5', active: true, lastSentAt: null });

    expect((await ana.get('/alerts')).json().items).toHaveLength(1);

    const paused = await ana.patch(`/alerts/${rule.id}`, { active: false });
    expect(paused.json().active).toBe(false);

    const edited = await ana.patch(`/alerts/${rule.id}`, { kind: 'change_down', threshold: 3 });
    expect(edited.json()).toMatchObject({ kind: 'change_down', threshold: '3' });

    expect((await ana.del(`/alerts/${rule.id}`)).statusCode).toBe(204);
    expect((await ana.get('/alerts')).json().items).toHaveLength(0);
  });

  it('reactivar ou mudar a condição repõe o estado da avaliação', async () => {
    const rule = (await ana.post('/alerts', { instrumentId: galp, kind: 'close_below', threshold: '10' })).json();
    await ctx.pool.query("UPDATE alert_rules SET last_state = TRUE, last_evaluated_session = '2026-10-16' WHERE id = ?", [rule.id]);
    await ana.patch(`/alerts/${rule.id}`, { active: false });
    let [[r]] = await ctx.pool.query('SELECT last_state FROM alert_rules WHERE id = ?', [rule.id]);
    expect(r.last_state).toBe(1);
    await ana.patch(`/alerts/${rule.id}`, { active: true });
    [[r]] = await ctx.pool.query('SELECT last_state FROM alert_rules WHERE id = ?', [rule.id]);
    expect(r.last_state).toBeNull();
  });

  it('valida o limite e o instrumento', async () => {
    expect((await ana.post('/alerts', { instrumentId: galp, kind: 'close_above', threshold: '-1' })).statusCode).toBe(400);
    expect((await ana.post('/alerts', { instrumentId: galp, kind: 'close_above', threshold: 'abc' })).statusCode).toBe(400);
    expect((await ana.post('/alerts', { instrumentId: galp, kind: 'outra', threshold: '1' })).statusCode).toBe(400);
    expect((await ana.post('/alerts', { instrumentId: 99999, kind: 'close_above', threshold: '1' })).statusCode).toBe(404);
  });

  it('um utilizador não vê nem altera as regras de outro', async () => {
    const rule = (await ana.post('/alerts', { instrumentId: galp, kind: 'change_up', threshold: '5' })).json();
    expect((await rui.get('/alerts')).json().items).toHaveLength(0);
    expect((await rui.patch(`/alerts/${rule.id}`, { active: false })).statusCode).toBe(404);
    expect((await rui.del(`/alerts/${rule.id}`)).statusCode).toBe(404);
    expect((await ana.get('/alerts')).json().items.find((x) => x.id === rule.id).active).toBe(true);
  });

  it('lista eventos com o estado do envio', async () => {
    const rule = (await ana.post('/alerts', { instrumentId: galp, kind: 'close_above', threshold: '5' })).json();
    await ctx.pool.query("INSERT INTO alert_events (rule_id, session_date, close) VALUES (?, '2026-10-16', '10.00')", [rule.id]);
    const ev = (await ana.get('/alerts/events')).json().items;
    expect(ev[0]).toMatchObject({ ruleId: rule.id, symbol: 'GALP.LS', deliveryStatus: 'pending' });
    expect((await rui.get('/alerts/events')).json().items).toHaveLength(0);
  });

  it('estado dos dados', async () => {
    const res = await ana.get('/status');
    expect(res.statusCode).toBe(200);
    expect(res.json().instruments.active).toBe(1);
  });
});
