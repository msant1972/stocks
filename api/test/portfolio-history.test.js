import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, hasTestDb, login, makeInstrument, makeUser, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('evolução da carteira', () => {
  let ctx;
  let ana;
  let galp;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt', '1000.00');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    galp = await makeInstrument(ctx.pool, 'GALP.LS', { closes: ['15.00', '16.00'] });
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('começa no capital inicial e acompanha as operações, até ao valor actual da carteira', async () => {
    let h = (await ana.get('/portfolio/history')).json();
    expect(h.initialCapital).toBe(1000);
    expect(h.points.at(-1)).toMatchObject({ cash: 1000, marketValue: 0, total: 1000 });

    const res = await ana.post('/simulated-trades', { instrumentId: galp, side: 'buy', quantity: 10, idempotencyKey: randomUUID().replaceAll('-', '') });
    expect(res.statusCode).toBe(201);
    h = (await ana.get('/portfolio/history')).json();
    const p = (await ana.get('/portfolio')).json();
    expect(h.points.at(-1)).toMatchObject({ cash: 840, marketValue: 160, total: Number(p.totalValue), netInvested: 160 });
    expect(h.points.every((x, i) => i === 0 || x.date > h.points[i - 1].date)).toBe(true);
  });
});
