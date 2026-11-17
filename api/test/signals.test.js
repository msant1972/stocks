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

  it('sinais de todas as estratégias, só nos instrumentos da minha lista', async () => {
    const empty = (await ana.get('/signals/watchlist')).json();
    expect(empty.items).toEqual([]);                                   // lista vazia
    const [[{ id }]] = await ctx.pool.query("SELECT id FROM instruments WHERE symbol = 'COMPRA.LS'");
    expect((await ana.post('/watchlist/items', { instrumentId: Number(id) })).statusCode).toBe(204);
    // Sem escolha e sem estratégia que ganhe (5 sessões de histórico): por omissão (only=chosen) não aparece nada.
    const hidden = (await ana.get('/signals/watchlist')).json();
    expect(hidden).toMatchObject({ only: 'chosen', items: [] });
    expect(hidden.hidden).toBeGreaterThan(0);
    expect((await ana.get('/signals/watchlist?only=all')).json().items.length).toBe(hidden.hidden);
    // Escolhida a A-Momentum no Charts: passa a aparecer só o sinal dela.
    expect((await ana.put(`/instruments/${id}/strategy`, { strategyId: 'a-momentum' })).statusCode).toBe(204);
    const mine = (await ana.get('/signals/watchlist')).json();
    expect(mine.items.map((i) => i.strategy)).toEqual(['a-momentum']);
    expect(mine.sessions).toBe(1);
    // A A-Momentum dá o sinal de compra construído no teste; cada item indica a sua estratégia.
    expect(mine.items.find((i) => i.strategy === 'a-momentum')).toMatchObject({ symbol: 'COMPRA.LS', side: 'buy', sessionsAgo: 0 });
    expect(mine.items.every((i) => i.symbol === 'COMPRA.LS')).toBe(true);
  });

  it('página Sinais: scope=watchlist aplica a estratégia só aos instrumentos da minha lista', async () => {
    // Do teste anterior: COMPRA.LS está na lista.
    const mine = (await ana.get('/signals?sessions=5&scope=watchlist')).json();
    expect(mine).toMatchObject({ scope: 'watchlist', instruments: 1 });
    expect(mine.items.map((i) => i.symbol)).toEqual(['COMPRA.LS']);
    expect(mine.items[0].chosen).toBe(true); // a A-Momentum é a escolhida (teste anterior)
    const [[{ id }]] = await ctx.pool.query("SELECT id FROM instruments WHERE symbol = 'COMPRA.LS'");
    // Filtro only=chosen nos Sinais: com outra estratégia escolhida, o sinal da A-Momentum fica escondido (e contado).
    expect((await ana.put(`/instruments/${id}/strategy`, { strategyId: 'c-ai' })).statusCode).toBe(204);
    const other = (await ana.get('/signals?sessions=5&scope=watchlist&only=chosen')).json();
    expect(other).toMatchObject({ only: 'chosen', hidden: 1, items: [] });
    expect((await ana.get('/signals?sessions=5&scope=watchlist')).json().items[0].chosen).toBe(false); // only=all por omissão
    // «Nenhuma»: também esconde.
    expect((await ana.put(`/instruments/${id}/strategy`, { strategyId: null })).statusCode).toBe(204);
    expect((await ana.get('/signals?sessions=5&scope=watchlist&only=chosen')).json().items).toEqual([]);
    expect((await ana.del(`/watchlist/items/${id}`)).statusCode).toBe(204);
    const none = (await ana.get('/signals?sessions=5&scope=watchlist')).json();
    expect(none).toMatchObject({ instruments: 0, items: [] });
    expect((await ana.get('/signals?sessions=5')).json()).toMatchObject({ scope: 'all', instruments: null }); // todo o catálogo, por omissão
  });

  it('escolha da estratégia: guardar, ler, voltar à melhor, e validação', async () => {
    const [[{ id }]] = await ctx.pool.query("SELECT id FROM instruments WHERE symbol = 'COMPRA.LS'");
    expect((await ana.put(`/instruments/${id}/strategy`, { strategyId: 'b-opus' })).statusCode).toBe(204);
    let items = (await ana.get('/strategy-choices')).json().items;
    expect(items).toEqual([expect.objectContaining({ instrumentId: Number(id), strategyId: 'b-opus' })]);
    // Só uma por instrumento: substitui.
    expect((await ana.put(`/instruments/${id}/strategy`, { strategyId: 'a-momentum' })).statusCode).toBe(204);
    items = (await ana.get('/strategy-choices')).json().items;
    expect(items.map((i) => i.strategyId)).toEqual(['a-momentum']);
    // Cada utilizador tem as suas.
    await makeUser(ctx.pool, 'rui@exemplo.pt');
    const rui = api(ctx.app, await login(ctx.app, 'rui@exemplo.pt'));
    expect((await rui.get('/strategy-choices')).json().items).toEqual([]);
    // Voltar à melhor apaga a escolha.
    expect((await ana.del(`/instruments/${id}/strategy`)).statusCode).toBe(204);
    expect((await ana.get('/strategy-choices')).json().items).toEqual([]);
    // Validação: estratégia desconhecida, instrumento inexistente, estratégia desligada, sem sessão.
    expect((await ana.put(`/instruments/${id}/strategy`, { strategyId: 'x' })).statusCode).toBe(400);
    expect((await ana.put('/instruments/999999/strategy', { strategyId: 'a-momentum' })).statusCode).toBe(404);
    await ctx.pool.query("INSERT INTO strategy_settings (strategy_id, enabled) VALUES ('l-macd', 0) ON DUPLICATE KEY UPDATE enabled = 0");
    expect((await ana.put(`/instruments/${id}/strategy`, { strategyId: 'l-macd' })).json().error.code).toBe('STRATEGY_DISABLED');
    await ctx.pool.query("DELETE FROM strategy_settings WHERE strategy_id = 'l-macd'");
    expect((await ctx.app.inject({ method: 'PUT', url: `/api/v1/instruments/${id}/strategy`, payload: { strategyId: null } })).statusCode).toBe(401);
    const [[a]] = await ctx.pool.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'strategy.choice'");
    expect(Number(a.n)).toBeGreaterThan(3);
  });
});
