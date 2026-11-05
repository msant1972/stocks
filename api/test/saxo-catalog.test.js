import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decideMatch, expectedExchange, nameScore, symbolRoot } from '../src/saxo/matching.js';
import { maybeWeeklyRecheck, startCatalogSync } from '../src/saxo/catalog-runner.js';
import { encryptSecret } from '../src/secrets.js';
import { api, hasTestDb, login, makeInstrument, makeUser, setup, TEST_SECRET_KEY } from './helpers.js';

describe('correspondência Yahoo → SAXO (regras)', () => {
  it('semelhança de nomes sem formas jurídicas, com siglas e palavras truncadas', () => {
    expect(nameScore('Deutsche Bank Aktiengesellschaft', 'Deutsche Bank AG')).toBe(1);
    expect(nameScore('Banco Bilbao Vizcaya Argentaria, S.A.', 'BBVA')).toBe(1);
    expect(nameScore('Nordea Bank Abp', 'Nordea Bank Abp')).toBe(1);
    expect(nameScore('Koninklijke KPN N.V.', 'KPN (Koninklijke)')).toBe(1);
    expect(nameScore('Société Générale Société anonyme', 'Societe Generale')).toBe(1);
    expect(nameScore('Bayer AG', 'Deutsche Bank AG')).toBe(0);
    expect(nameScore('', 'X')).toBe(0);
  });

  it('raiz do símbolo e bolsa esperada', () => {
    expect(symbolRoot('NDA-FI.HE')).toBe('NDA');
    expect(symbolRoot('bayn.de')).toBe('BAYN');
    expect(expectedExchange({ exchange: 'Milan', mic: 'MTAA' })).toBe('MIL'); // pela bolsa, não pelo MIC (MTAA ≠ XMIL)
    expect(expectedExchange({ exchange: 'Teste', mic: 'XLIS' }, new Map([['XLIS', 'LISB']]))).toBe('LISB');
    expect(expectedExchange({ exchange: 'Teste', mic: null })).toBeNull();
  });

  const c = (uic, symbol, description, exchangeId, currency = 'EUR') => ({ uic, symbol, description, exchangeId, currency, assetType: 'Stock' });
  const bayer = { symbol: 'BAYN.DE', name: 'Bayer Aktiengesellschaft', currency: 'EUR' };

  it('ISIN: um só candidato na bolsa certa', () => {
    const d = decideMatch({ symbol: 'GALP.LS', name: 'Galp', currency: 'EUR' }, [c(1, 'GALP:xlis', 'Galp Energia', 'LISB'), c(2, 'GALP:xmce', 'Galp Energia', 'SIBE')], { exchangeId: 'LISB', byIsin: true });
    expect(d).toMatchObject({ status: 'auto', rule: 'isin', candidate: { uic: 1 } });
  });

  it('símbolo na bolsa certa, com o nome parecido; nome diferente não é aceite em silêncio', () => {
    expect(decideMatch(bayer, [c(10, 'BAYN:xetr', 'Bayer AG', 'FSE'), c(11, 'BAYN:xmil', 'Bayer AG', 'MIL')], { exchangeId: 'FSE' }))
      .toMatchObject({ status: 'auto', rule: 'symbol', candidate: { uic: 10 } });
    expect(decideMatch(bayer, [c(10, 'BAYN:xetr', 'Bayan Resources', 'FSE')], { exchangeId: 'FSE' })).toMatchObject({ status: 'ambiguous' });
  });

  it('pelo nome quando o símbolo é outro; empate fica ambíguo', () => {
    const nordea = { symbol: 'NDA-FI.HE', name: 'Nordea Bank Abp', currency: 'EUR' };
    expect(decideMatch(nordea, [c(20, 'NDAFI:xhel', 'Nordea Bank Abp', 'HSE')], { exchangeId: 'HSE' }))
      .toMatchObject({ status: 'auto', rule: 'name', candidate: { uic: 20 } });
    const two = [c(30, 'VOW:xetr', 'Volkswagen AG', 'FSE'), c(31, 'VOW3:xetr', 'Volkswagen AG', 'FSE')];
    expect(decideMatch({ symbol: 'VW.DE', name: 'Volkswagen AG', currency: 'EUR' }, two, { exchangeId: 'FSE' }).status).toBe('ambiguous');
  });

  it('só noutra bolsa, outra moeda e nada encontrado', () => {
    const glanbia = { symbol: 'GL9.IR', name: 'Glanbia plc', currency: 'EUR' };
    expect(decideMatch(glanbia, [c(40, 'GLB:xlon', 'Glanbia Plc', 'LSE_SETS', 'GBP')], { exchangeId: 'ISE' }))
      .toMatchObject({ status: 'other_market', candidates: [{ uic: 40 }] });
    expect(decideMatch(glanbia, [], { exchangeId: 'ISE' })).toEqual({ status: 'not_found', candidates: [] });
  });
});

/** Servidor SAXO falso que responde à pesquisa conforme as palavras-chave. */
function fakeSaxo({ search = {}, details = {} } = {}) {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const p = u.pathname.replace('/sim/openapi', '');
    calls.push({ method: init.method, path: p, query: Object.fromEntries(u.searchParams) });
    if (p === '/port/v1/accounts/me') return json({ Data: [{ AccountKey: 'acc', AccountId: '1', Currency: 'EUR', Active: true, IsTrialAccount: true }] });
    if (p === '/ref/v1/exchanges') return json({ Data: [{ ExchangeId: 'LISB', Mic: 'XLIS' }, { ExchangeId: 'FSE', Mic: 'XETR' }, { ExchangeId: 'HSE', Mic: 'XHEL' }] });
    if (p === '/ref/v1/instruments') return json({ Data: search[u.searchParams.get('Keywords')] ?? [] });
    const m = p.match(/^\/ref\/v1\/instruments\/details\/(\d+)\/Stock$/);
    if (m) {
      const d = typeof details[m[1]] === 'function' ? details[m[1]]() : details[m[1]];
      return d ? json(d) : json({}, 404);
    }
    return json({}, 404);
  };
  return { fetchImpl, calls };
}

const row = (Identifier, Symbol, Description, ExchangeId, CurrencyCode = 'EUR') => ({ AssetType: 'Stock', Identifier, Symbol, Description, ExchangeId, CurrencyCode });
const detail = (Uic, Symbol, Description, ExchangeId, extra = {}) => ({
  Uic, Symbol, Description, CurrencyCode: 'EUR', IsTradable: true, SupportedOrderTypes: ['Market', 'Limit'], MinimumTradeSize: 1, Exchange: { ExchangeId }, ...extra,
});

describe.skipIf(!hasTestDb)('ligação do catálogo à SAXO', () => {
  let ctx;
  let adminId;
  let admin;
  let ana;
  const ids = {};
  let galpTradable = true;
  const saxo = () => fakeSaxo({
    search: {
      PTGAL0AM0009: [row(23737, 'GALP:xlis', 'Galp Energia SGPS SA', 'LISB')],
      BAYN: [row(100, 'BAYN:xetr', 'Bayer AG', 'FSE'), row(101, 'BAYN:xmil', 'Bayer AG', 'MIL')],
      NDA: [],
      'nordea bank': [row(200, 'NDAFI:xhel', 'Nordea Bank Abp', 'HSE')],
      GL9: [], glanbia: [row(300, 'GLB:xlon', 'Glanbia Plc', 'LSE_SETS', 'GBP')],
    },
    details: {
      23737: () => detail(23737, 'GALP:xlis', 'Galp Energia SGPS SA', 'LISB', { IsTradable: galpTradable }),
      100: detail(100, 'BAYN:xetr', 'Bayer AG', 'FSE'),
      200: detail(200, 'NDAFI:xhel', 'Nordea Bank Abp', 'HSE'),
    },
  });

  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.saxo.catalogPauseMs = 0;
    ctx.cfg.saxo.sleep = async () => {};
    ctx.cfg.saxo.fetchImpl = saxo().fetchImpl;
    adminId = await makeUser(ctx.pool, 'admin@exemplo.pt');
    await ctx.pool.query('UPDATE users SET is_admin = 1 WHERE id = ?', [adminId]);
    admin = api(ctx.app, await login(ctx.app, 'admin@exemplo.pt'));
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    await ctx.pool.query(
      `INSERT INTO user_integration_tokens (user_id, provider, token_enc, environment, auth_kind, refresh_token_enc, expires_at, refresh_expires_at)
       VALUES (?, 'saxo', ?, 'sim', 'oauth', ?, NOW(3) + INTERVAL 20 MINUTE, NOW(3) + INTERVAL 40 MINUTE)`,
      [adminId, encryptSecret(TEST_SECRET_KEY, 'tok'), encryptSecret(TEST_SECRET_KEY, 'ref')],
    );
    const add = async (symbol, exchange, name, isin = null) => {
      const id = await makeInstrument(ctx.pool, symbol);
      await ctx.pool.query('UPDATE instruments SET exchange = ?, name = ?, isin = ? WHERE id = ?', [exchange, name, isin, id]);
      ids[symbol] = id;
    };
    await add('GALP.LS', 'Lisbon', 'Galp Energia, SGPS, S.A.', 'PTGAL0AM0009');
    await add('BAYN.DE', 'XETRA', 'Bayer Aktiengesellschaft');
    await add('NDA-FI.HE', 'Helsinki', 'Nordea Bank Abp');
    await add('GL9.IR', 'Irish', 'Glanbia plc');
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('só administradores', async () => {
    expect((await ana.get('/saxo/catalog')).statusCode).toBe(403);
    expect((await ana.post('/saxo/catalog/sync', {})).statusCode).toBe(403);
  });

  it('liga por ISIN, símbolo e nome; regista o que fica por resolver', async () => {
    const { done } = await startCatalogSync(ctx.pool, ctx.cfg, adminId, { sleep: async () => {} });
    await done;
    const b = (await admin.get('/saxo/catalog')).json();
    const by = Object.fromEntries(b.items.map((i) => [i.symbol, i]));
    expect(by['GALP.LS']).toMatchObject({ status: 'linked', saxo: { uic: 23737, source: 'auto' } });
    expect(by['BAYN.DE']).toMatchObject({ status: 'linked', saxo: { symbol: 'BAYN:xetr', exchangeId: 'FSE', nameScore: 1 } });
    expect(by['NDA-FI.HE']).toMatchObject({ status: 'linked', saxo: { uic: 200 } });
    expect(by['GL9.IR']).toMatchObject({ status: 'other_market', candidates: [{ uic: 300, symbol: 'GLB:xlon' }] });
    expect(b.summary).toEqual({ linked: 3, other_market: 1 });
    expect(b.lastRun).toMatchObject({ status: 'done', total: 4, processed: 4, counts: { linked: 3, other_market: 1 }, trigger: 'manual' });
  });

  it('pelo endpoint: corre em segundo plano; a revalidação marca o que deixou de ser negociável', async () => {
    galpTradable = false;
    const res = await admin.post('/saxo/catalog/sync', { recheck: true });
    expect(res.statusCode).toBe(202);
    for (let i = 0; i < 50 && (await admin.get('/saxo/catalog')).json().lastRun.status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    const b = (await admin.get('/saxo/catalog')).json();
    expect(b.lastRun).toMatchObject({ status: 'done', recheck: true });
    expect(b.items.find((i) => i.symbol === 'GALP.LS')).toMatchObject({ status: 'not_tradable' });
    galpTradable = true;
  });

  it('desligar volta a «por procurar»; a escolha manual resolve o problema', async () => {
    expect((await admin.del(`/saxo/instruments/${ids['GALP.LS']}/match`)).statusCode).toBe(204);
    let b = (await admin.get('/saxo/catalog')).json();
    expect(b.items.find((i) => i.symbol === 'GALP.LS').status).toBe('unchecked');
    const r = await admin.post(`/saxo/instruments/${ids['GALP.LS']}/match`, { uic: 23737 });
    expect(r.json()).toEqual({ uic: 23737, symbol: 'GALP:xlis' });
    b = (await admin.get('/saxo/catalog')).json();
    expect(b.items.find((i) => i.symbol === 'GALP.LS')).toMatchObject({ status: 'linked', saxo: { source: 'manual' } });
  });

  it('revalidação semanal: só passados 7 dias desde a última ligação', async () => {
    expect(await maybeWeeklyRecheck(ctx.pool, ctx.cfg)).toBeNull();
    await ctx.pool.query('UPDATE saxo_catalog_runs SET started_at = NOW(3) - INTERVAL 8 DAY');
    const run = await maybeWeeklyRecheck(ctx.pool, ctx.cfg);
    expect(run).not.toBeNull();
    await run.done;
    const [[r]] = await ctx.pool.query('SELECT trigger_kind, recheck, status FROM saxo_catalog_runs ORDER BY id DESC LIMIT 1');
    expect(r).toMatchObject({ trigger_kind: 'weekly', recheck: 1, status: 'done' });
  });
});
