import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, hasTestDb, login, makeInstrument, makeUser, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('mapa de calor', () => {
  let ctx;
  let ana;
  let a;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    // 7 sessões cada; volume 1000 por sessão (helpers).
    a = await makeInstrument(ctx.pool, 'SOBE.LS', { closes: ['10', '10', '10', '10', '10', '10', '11'] });
    await makeInstrument(ctx.pool, 'DESCE.LS', { closes: ['20', '20', '20', '20', '20', '20', '19'] });
    await makeInstrument(ctx.pool, 'CURTO.LS', { closes: ['5', '5', '5'] }); // menos de 6 sessões
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('calcula variação e valor negociado nas últimas N sessões', async () => {
    const res = await ana.get('/heatmap?period=5');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period).toBe(5);
    expect(body.items.map((i) => i.symbol)).toEqual(['DESCE.LS', 'SOBE.LS']); // por valor negociado
    const sobe = body.items.find((i) => i.symbol === 'SOBE.LS');
    expect(sobe).toMatchObject({ changePct: '10.00', tradedValue: String((10 * 4 + 11) * 1000) });
    expect(body.items.find((i) => i.symbol === 'DESCE.LS').changePct).toBe('-5.00');
  });

  it('período de 1 sessão e lista do utilizador', async () => {
    expect((await ana.get('/heatmap?period=1')).json().items.find((i) => i.symbol === 'SOBE.LS').tradedValue).toBe('11000');
    expect((await ana.get('/heatmap?period=1')).json().items.map((i) => i.symbol)).toContain('CURTO.LS');
    await ana.post('/watchlist/items', { instrumentId: a });
    expect((await ana.get('/heatmap?scope=watchlist')).json().items.map((i) => i.symbol)).toEqual(['SOBE.LS']);
  });

  it('limita aos N instrumentos com maior valor negociado (20 por omissão)', async () => {
    expect((await ana.get('/heatmap?period=1')).json()).toMatchObject({ total: 3 });
    const top = (await ana.get('/heatmap?period=1&limit=1')).json();
    expect(top.total).toBe(3);
    expect(top.items.map((i) => i.symbol)).toEqual(['DESCE.LS']);
    expect((await ana.get('/heatmap?limit=0')).statusCode).toBe(400);
  });

  it('recusa períodos não suportados', async () => {
    expect((await ana.get('/heatmap?period=7')).statusCode).toBe(400);
  });
});
