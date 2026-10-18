import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, hasTestDb, login, makeInstrument, makeUser, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('sinais da estratégia', () => {
  let ctx;
  let ana;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    // SMA200 constante (10); a SMA10 define os estados: desce (idx 2), sobe (3), sobe (4) → compra na última sessão.
    const sma10 = ['10.5', '10.4', '10.3', '10.6', '10.8'];
    const id = await makeInstrument(ctx.pool, 'COMPRA.LS', { closes: ['20', '20', '20', '21', '22'] });
    const [dates] = await ctx.pool.query('SELECT session_date FROM daily_quotes WHERE instrument_id = ? ORDER BY session_date', [id]);
    for (let k = 0; k < dates.length; k++) {
      await ctx.pool.query('UPDATE daily_quotes SET sma10 = ?, sma200 = 10, sma125 = 10 WHERE instrument_id = ? AND session_date = ?', [sma10[k], id, dates[k].session_date]);
    }
    await makeInstrument(ctx.pool, 'SEMSINAL.LS', { closes: ['5', '5', '5'] }); // sem SMA200: sem estado nem sinais
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('aplica a estratégia a todos os instrumentos e devolve os sinais recentes', async () => {
    const res = await ana.get('/signals?sessions=5');
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.items).toHaveLength(1);
    expect(b.items[0]).toMatchObject({ symbol: 'COMPRA.LS', side: 'buy', sessionsAgo: 0, price: '22.000000', changeSincePct: '0.00', momentumPct: '8.00' });
  });

  it('respeita a janela de sessões', async () => {
    // Com 1 sessão o sinal (na última sessão) continua; a regra de janela usa as sessões do próprio instrumento.
    expect((await ana.get('/signals?sessions=1')).json().items).toHaveLength(1);
    expect((await ana.get('/signals?sessions=0')).statusCode).toBe(400);
  });
});
