import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, hasTestDb, login, makeUser, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('Laboratório: experiências', () => {
  let ctx;
  let ana;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('começa com as experiências já feitas, a decorrer primeiro', async () => {
    const { items } = (await ana.get('/experiments')).json();
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items[0].status).toBe('running');
    expect(items.find((e) => e.title.startsWith('B-Opus: filtro'))).toMatchObject({ status: 'dropped', decidedOn: '2026-10-24' });
  });

  it('regista, altera e apaga, com auditoria; valida o pedido', async () => {
    const created = await ana.post('/experiments', { title: 'Stops mais largos', hypothesis: 'Menos vendas por ruído', metric: 'Acerto', startedOn: '2026-11-08' });
    expect(created.statusCode).toBe(201);
    const e = created.json();
    expect(e).toMatchObject({ title: 'Stops mais largos', status: 'idea', result: null, createdBy: expect.any(String), startedOn: '2026-11-08' });
    const upd = await ana.patch(`/experiments/${e.id}`, { status: 'dropped', result: 'Não melhorou o acerto', decidedOn: '2026-11-20' });
    expect(upd.json()).toMatchObject({ status: 'dropped', result: 'Não melhorou o acerto', decidedOn: '2026-11-20', hypothesis: 'Menos vendas por ruído' });
    const cleared = (await ana.patch(`/experiments/${e.id}`, { hypothesis: '' })).json();
    expect(cleared).toMatchObject({ hypothesis: null, status: 'dropped' }); // alterar um campo não repõe o estado
    expect((await ana.post('/experiments', { title: 'x' })).statusCode).toBe(400);
    expect((await ana.post('/experiments', { title: 'Válida', status: 'talvez' })).statusCode).toBe(400);
    expect((await ana.patch(`/experiments/${e.id}`, {})).statusCode).toBe(400);
    expect((await ana.del(`/experiments/${e.id}`)).statusCode).toBe(204);
    expect((await ana.del(`/experiments/${e.id}`)).statusCode).toBe(404);
    const [audit] = await ctx.pool.query("SELECT action FROM audit_log WHERE action LIKE 'experiment.%' ORDER BY id");
    expect(audit.map((a) => a.action)).toEqual(['experiment.create', 'experiment.update', 'experiment.update', 'experiment.delete']);
  });

  it('sem sessão não chega', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/experiments' })).statusCode).toBe(401);
  });
});
