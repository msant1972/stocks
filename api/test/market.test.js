import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, hasTestDb, login, makeInstrument, makeUser, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('momento do mercado', () => {
  let ctx;
  let ana;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    const momentum = { 'FORTE.LS': [12, 10], 'MEDIO.LS': [10.5, 10], 'NEUTRO.LS': [10.1, 10], 'LIMITE.LS': [9.9, 10], 'FRACO.LS': [8, 10] };
    for (const [symbol, [sma10, sma200]] of Object.entries(momentum)) {
      const id = await makeInstrument(ctx.pool, symbol, { closes: ['10'] });
      await ctx.pool.query('UPDATE daily_quotes SET sma10 = ?, sma200 = ? WHERE instrument_id = ?', [sma10, sma200, id]);
    }
    await makeInstrument(ctx.pool, 'SEMSMA.LS', { closes: ['10'] }); // sem SMA200: fica de fora
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('distribui por zona e devolve os extremos', async () => {
    const res = await ana.get('/market/momentum?top=2');
    expect(res.statusCode).toBe(200);
    const b = res.json();
    // +20%, +5% acima; +1% e −1% neutros (limites incluídos); −20% abaixo
    expect([b.total, b.above, b.neutral, b.below]).toEqual([5, 2, 2, 1]);
    expect(b.strongest.map((e) => [e.symbol, e.momentumPct])).toEqual([['FORTE.LS', '20.00'], ['MEDIO.LS', '5.00']]);
    expect(b.weakest.map((e) => [e.symbol, e.momentumPct])).toEqual([['FRACO.LS', '-20.00'], ['LIMITE.LS', '-1.00']]);
  });
});
