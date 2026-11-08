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

describe.skipIf(!hasTestDb)('calor: valor negociado do catálogo', () => {
  let ctx;
  let ana;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'calor@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'calor@exemplo.pt'));
    const a = await makeInstrument(ctx.pool, 'A.LS', { closes: ['10', '10', '10'] });
    await makeInstrument(ctx.pool, 'B.LS', { closes: ['20', '20', '20'] });
    await makeInstrument(ctx.pool, 'FORA.LS', { closes: ['99', '99', '99'], status: 'invalid' });
    // Sessão do meio de A com OHLC diferentes: VN = 1000 × (8 + 9 + 12 + 11) / 4 = 10 000.
    const [[mid]] = await ctx.pool.query('SELECT session_date AS d FROM daily_quotes WHERE instrument_id = ? ORDER BY session_date LIMIT 1 OFFSET 1', [a]);
    await ctx.pool.query('UPDATE daily_quotes SET open = 8, low = 9, high = 12, close = 11 WHERE instrument_id = ? AND session_date = ?', [a, mid.d]);
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('soma VN = volume × (O + Mín + Máx + F) / 4 dos instrumentos activos, por sessão', async () => {
    const res = await ana.get('/market/turnover');
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.points.map((p) => [p.value, p.instruments, p.sma200])).toEqual([[30000, 2, null], [30000, 2, null], [30000, 2, null]]);
    expect(b.summary).toMatchObject({ value: 30000, sma200: null, vsSma200: null });
    expect(b).toMatchObject({ partial: null, currency: 'EUR' });
  });
});

describe.skipIf(!hasTestDb)('calor: capitalização do catálogo', () => {
  let ctx;
  let ana;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'cap@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'cap@exemplo.pt'));
    const a = await makeInstrument(ctx.pool, 'A.LS', { closes: ['10', '11', '12'] });
    const b = await makeInstrument(ctx.pool, 'B.LS', { closes: ['20', '20', '20'] });
    await makeInstrument(ctx.pool, 'SEMACCOES.LS', { closes: ['5', '5', '5'] }); // sem número de acções: fica de fora
    const fora = await makeInstrument(ctx.pool, 'FORA.LS', { closes: ['99', '99', '99'], status: 'invalid' });
    for (const [id, shares] of [[a, 1000], [b, 500], [fora, 1e6]]) {
      await ctx.pool.query('INSERT INTO company_profiles (instrument_id, shares_outstanding) VALUES (?, ?)', [id, shares]);
    }
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('soma fecho × acções dos instrumentos activos com número de acções', async () => {
    const res = await ana.get('/market/cap');
    expect(res.statusCode).toBe(200);
    const b = res.json();
    // A: 10 000, 11 000, 12 000; B: 10 000 em todas as sessões
    expect(b.points.map((p) => [p.value, p.instruments])).toEqual([[20000, 2], [21000, 2], [22000, 2]]);
    expect(b.summary).toMatchObject({ value: 22000, sma200: null });
    expect(b).toMatchObject({ partial: null, coverage: { total: 3, withShares: 2 }, currency: 'EUR' });
  });
});

describe.skipIf(!hasTestDb)('timelapse: top do valor negociado', () => {
  let ctx;
  let ana;
  let a;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'tl@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'tl@exemplo.pt'));
    const sessions = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10));
    a = await makeInstrument(ctx.pool, 'A.LS', { closes: sessions.map(() => '10'), sessions }); // 10 000 por sessão
    await makeInstrument(ctx.pool, 'B.LS', { closes: sessions.map(() => '20'), sessions });     // 20 000 por sessão
    await ana.post('/watchlist/items', { instrumentId: a });
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('catálogo e lista: top por 10 sessões, do mais antigo para o mais recente', async () => {
    const res = await ana.get('/market/timelapse?window=10');
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b).toMatchObject({ universe: 'catalogo', window: 10, sessions: 22, top: 30, size: 2, partialExcluded: null });
    expect(b.frames.map((f) => f.date)).toEqual(['2026-10-11', '2026-10-12']);
    expect(b.frames[0]).toMatchObject({ from: '2026-10-02', items: [{ value: 200000, change: 0 }, { id: a, value: 100000, change: 0 }] });
    expect((await ana.get('/market/timelapse')).json().window).toBe(5); // por omissão, 5 sessões
    expect(b.instruments.map((i) => i.symbol).sort()).toEqual(['A.LS', 'B.LS']);
    const lista = (await ana.get('/market/timelapse?universe=lista')).json();
    expect(lista).toMatchObject({ universe: 'lista', size: 1, instruments: [{ id: a, symbol: 'A.LS' }] });
    expect(lista.frames.every((f) => f.items.length === 1 && f.items[0].id === a)).toBe(true);
  });

  it('sessões somadas: 1, 5 ou 10', async () => {
    const one = (await ana.get('/market/timelapse?window=1')).json();
    expect(one).toMatchObject({ window: 1 });
    expect(one.frames).toHaveLength(11); // 12 sessões de dados: a primeira só serve de referência do preço
    expect(one.frames[0]).toMatchObject({ from: '2026-10-02', date: '2026-10-02', items: [{ value: 20000 }, { id: a, value: 10000 }] });
    expect((await ana.get('/market/timelapse?window=5')).json().frames[0]).toMatchObject({ from: '2026-10-02', date: '2026-10-06' });
    expect((await ana.get('/market/timelapse?window=3')).statusCode).toBe(400);
  });

  it('Saxo sem ligação: diz que não está ligado', async () => {
    const res = await ana.get('/market/timelapse?universe=saxo');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SAXO_NO_TOKEN');
  });
});
