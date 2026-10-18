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

describe.skipIf(!hasTestDb)('cruzamentos SMA10 / SMA50', () => {
  let ctx;
  let ana;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    // 8 sessões; pares [sma10, sma50] da mais antiga para a mais recente.
    const series = {
      'SOBE.LS': [[9, 10], [9, 10], [9, 10], [9, 10], [9, 10], [9, 10], [11, 10], [12, 10]],   // cruza para cima na 7.ª (há 1 sessão)
      'DESCE.LS': [[11, 10], [11, 10], [11, 10], [11, 10], [9, 10], [9, 10], [9, 10], [9, 10]], // cruza para baixo na 5.ª (há 3 sessões)
      'ANTIGO.LS': [[9, 10], [11, 10], [11, 10], [11, 10], [11, 10], [11, 10], [11, 10], [11, 10]], // cruzou há 6 sessões: fora
      'VAIVEM.LS': [[9, 10], [9, 10], [9, 10], [9, 10], [11, 10], [11, 10], [9, 10], [9, 10]],  // sobe e desce: conta o mais recente (descida)
      'IGUAL.LS': [[9, 10], [9, 10], [9, 10], [9, 10], [9, 10], [9, 10], [10, 10], [10, 10]],   // toca mas não ultrapassa
    };
    for (const [symbol, pairs] of Object.entries(series)) {
      const id = await makeInstrument(ctx.pool, symbol, { closes: pairs.map(() => '10') });
      const [dates] = await ctx.pool.query('SELECT session_date FROM daily_quotes WHERE instrument_id = ? ORDER BY session_date', [id]);
      for (let k = 0; k < pairs.length; k++) {
        await ctx.pool.query('UPDATE daily_quotes SET sma10 = ?, sma50 = ? WHERE instrument_id = ? AND session_date = ?', [...pairs[k], id, dates[k].session_date]);
      }
    }
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('lista cruzamentos ascendentes e descendentes nas últimas 5 sessões', async () => {
    const res = await ana.get('/market/crossovers?sessions=5');
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.up.map((e) => [e.symbol, e.sessionsAgo, e.gapPct])).toEqual([['SOBE.LS', 1, '20.00']]);
    expect(b.down.map((e) => [e.symbol, e.sessionsAgo])).toEqual([['VAIVEM.LS', 1], ['DESCE.LS', 3]]);
  });
});
