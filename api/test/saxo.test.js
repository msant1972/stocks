import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSaxoClient, createThrottle } from '../src/saxo/client.js';
import { signState } from '../src/saxo/oauth.js';
import { refreshDueTokens } from '../src/saxo/tokens.js';
import { watchOrders } from '../src/saxo/watcher.js';
import { decryptSecret, encryptSecret } from '../src/secrets.js';
import { api, hasTestDb, login, makeInstrument, makeUser, setup, TEST_SECRET_KEY } from './helpers.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'saxo');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
const TOKEN = 'token-secreto-da-saxo-123';

const parseBody = (b) => {
  if (!b) return null;
  try { return JSON.parse(b); } catch { return Object.fromEntries(new URLSearchParams(b)); }
};

/** Servidor SAXO falso a partir das fixtures reais. `over` substitui respostas por "METODO /caminho". */
function fakeSaxo(over = {}) {
  const calls = [];
  const routes = {
    'GET /port/v1/accounts/me': fx('accounts-me'),
    'GET /port/v1/balances/me': fx('balances-me'),
    'GET /ref/v1/exchanges': fx('exchanges-eur'),
    'GET /ref/v1/instruments': fx('instruments-isin'),
    'GET /ref/v1/instruments/details/23737/Stock': fx('instrument-details-galp'),
    'POST /trade/v2/orders/precheck': fx('precheck-ok'),
    'POST /trade/v2/orders': fx('order-placed'),
    'GET /port/v1/orders/me': fx('orders-working'),
    'DELETE /trade/v2/orders/5041484162': fx('order-cancelled'),
    ...over,
  };
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname.replace('/sim/openapi', '')}`;
    calls.push({ key, headers: init.headers, body: parseBody(init.body), query: Object.fromEntries(u.searchParams) });
    let r = routes[key];
    if (typeof r === 'function') r = r(calls.filter((c) => c.key === key).length);
    if (!r) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
  };
  return { fetchImpl, calls };
}

describe('cliente da SAXO', () => {
  const mk = (fetchImpl, extra = {}) => createSaxoClient({ baseUrl: 'https://x.test/sim/openapi', token: TOKEN, fetchImpl, sleep: async () => {}, ...extra });
  const json = (status, body, headers) => async () => new Response(JSON.stringify(body), { status, headers });

  it('envia o token no cabeçalho e devolve o JSON', async () => {
    const { fetchImpl, calls } = fakeSaxo();
    expect((await mk(fetchImpl).get('/port/v1/accounts/me')).Data).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('401 → token expirado e avisa quem chama; o erro não traz o token', async () => {
    let called = false;
    const err = await mk(json(401, {}), { onUnauthorized: () => { called = true; } }).get('/x').catch((e) => e);
    expect(err).toMatchObject({ status: 409, code: 'SAXO_TOKEN_EXPIRED' });
    expect(called).toBe(true);
    expect(JSON.stringify(err.message)).not.toContain(TOKEN);
  });

  it('429: espera e repete uma vez; à segunda desiste', async () => {
    let n = 0;
    const ok = await mk(async () => (++n === 1 ? new Response('{}', { status: 429, headers: { 'x-ratelimit-tradeorderspost-reset': '1' } }) : new Response('{"OrderId":"1"}', { status: 200 }))).post('/trade/v2/orders', {});
    expect(ok.OrderId).toBe('1');
    expect(n).toBe(2);
    n = 0;
    await expect(mk(async () => { n++; return new Response('{}', { status: 429 }); }).post('/trade/v2/orders', {})).rejects.toMatchObject({ code: 'SAXO_RATE_LIMITED', status: 429 });
    expect(n).toBe(2);
  });

  it('409 em ordens → duplicado, sem repetir; 5xx e rede → 502; outros 4xx → 422 com a mensagem da SAXO', async () => {
    let n = 0;
    await expect(mk(async () => { n++; return new Response('{}', { status: 409 }); }).post('/trade/v2/orders', {})).rejects.toMatchObject({ code: 'SAXO_DUPLICATE' });
    expect(n).toBe(1);
    await expect(mk(json(503, {})).get('/x')).rejects.toMatchObject({ code: 'SAXO_UNAVAILABLE', status: 502 });
    await expect(mk(async () => { throw new TypeError('fetch failed'); }).get('/x')).rejects.toMatchObject({ code: 'SAXO_UNAVAILABLE' });
    await expect(mk(json(400, { ErrorInfo: { Message: 'Preço fora do intervalo' } })).post('/trade/v2/orders', {})).rejects.toMatchObject({ code: 'SAXO_REJECTED', message: 'Preço fora do intervalo' });
  });

  it('o espaçamento de ordens é por utilizador', async () => {
    let t = 10_000;
    const slept = [];
    const wait = createThrottle(1000, { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
    await wait(1); await wait(1); await wait(2);
    expect(slept).toEqual([1000]);
  });
});

describe.skipIf(!hasTestDb)('ordens para a SAXO (SIM)', () => {
  let ctx;
  let ana;
  let anaId;
  let ruiId;
  let rui;
  let galp;
  let seq = 0;
  const base = () => ({ instrumentId: galp, side: 'buy', quantity: 10, orderType: 'limit', limitPrice: '9.5' });
  const useSaxo = (over) => { const f = fakeSaxo(over); ctx.cfg.saxo.fetchImpl = f.fetchImpl; return f; };
  // Directo na BD: o PUT tem limite de pedidos por minuto e cada teste começa de zero.
  const saveToken = (userId) => ctx.pool.query(
    "REPLACE INTO user_integration_tokens (user_id, provider, token_enc, environment, expires_at) VALUES (?, 'saxo', ?, 'sim', NOW(3) + INTERVAL 24 HOUR)",
    [userId, encryptSecret(TEST_SECRET_KEY, TOKEN)],
  );
  const preview = (extra = {}) => ana.post('/saxo/orders/preview', { ...base(), ...extra });
  const place = async (extra = {}) => {
    const p = (await preview()).json();
    return ana.post('/saxo/orders', { ...base(), confirmation: p.confirmation, idempotencyKey: `ordem-teste-${Date.now()}-${++seq}`, ...extra });
  };

  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.saxo.orderSpacingMs = 0;
    ctx.cfg.saxo.sleep = async () => {};
    // Utilizadores e logins uma só vez: o login tem limite de pedidos por minuto.
    anaId = await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    ruiId = await makeUser(ctx.pool, 'rui@exemplo.pt');
    rui = api(ctx.app, await login(ctx.app, 'rui@exemplo.pt'));
  });
  beforeEach(async () => {
    await ctx.pool.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['user_saxo_apps', 'saxo_notifications', 'saxo_alert_settings', 'saxo_orders', 'saxo_instruments', 'user_integration_tokens', 'daily_quotes', 'instruments', 'audit_log']) {
      await ctx.pool.query(`TRUNCATE TABLE ${t}`);
    }
    await ctx.pool.query('SET FOREIGN_KEY_CHECKS = 1');
    galp = await makeInstrument(ctx.pool, 'GALP.LS', { closes: ['10.00'] });
    await ctx.pool.query("UPDATE instruments SET isin = 'PTGAL0AM0009', mic = 'XLIS' WHERE id = ?", [galp]);
    useSaxo();
    await saveToken(anaId);
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('sem token, pede para o guardar; com token expirado ou recusado, pede um novo', async () => {
    await ana.del('/me/integrations/saxo');
    expect((await ana.get('/saxo/connection')).json().error.code).toBe('SAXO_NO_TOKEN');
    await saveToken(anaId);
    await ctx.pool.query("UPDATE user_integration_tokens SET expires_at = NOW(3) - INTERVAL 1 MINUTE");
    expect((await ana.get('/saxo/connection')).json().error.code).toBe('SAXO_TOKEN_EXPIRED');
    expect((await ana.get('/me/integrations/saxo')).json()).toMatchObject({ configured: true, expired: true, environment: 'sim' });
    expect((await ana.put('/me/integrations/saxo', { token: TOKEN })).statusCode).toBe(200); // um token novo repõe a validade
    expect((await ana.get('/me/integrations/saxo')).json()).toMatchObject({ expired: false });
    expect((await ana.get('/saxo/connection')).statusCode).toBe(200);
  });

  it('a SAXO a recusar o token (401) marca-o como expirado', async () => {
    useSaxo({ 'GET /port/v1/accounts/me': { status: 401, body: {} } });
    expect((await ana.get('/saxo/connection')).json().error.code).toBe('SAXO_TOKEN_EXPIRED');
    expect((await ana.get('/me/integrations/saxo')).json().expired).toBe(true);
  });

  it('marcar o token como recusado não altera a data em que foi guardado', async () => {
    await ctx.pool.query("UPDATE user_integration_tokens SET updated_at = '2026-01-01 10:00:00.000'");
    useSaxo({ 'GET /port/v1/accounts/me': { status: 401, body: {} } });
    await ana.get('/saxo/connection');
    const s = (await ana.get('/me/integrations/saxo')).json();
    expect(s.expired).toBe(true);
    expect(s.updatedAt).toBe('2026-01-01T10:00:00.000Z');
  });

  it('um envio que ficou a meio passa a «por confirmar»; os recentes não mexem', async () => {
    const row = (key, age) => ctx.pool.query(
      "INSERT INTO saxo_orders (user_id, instrument_id, idempotency_key, side, quantity, order_type, status, created_at) VALUES (?, ?, ?, 'buy', 1, 'market', 'sending', NOW(3) - INTERVAL ? SECOND)",
      [anaId, galp, key, age],
    );
    await row('envio-antigo-aaaa', 300);
    await row('envio-recente-aaaa', 5);
    const items = (await ana.get('/saxo/orders')).json().items;
    expect(items.map((o) => o.status).sort()).toEqual(['sending', 'unknown']);
    expect(items.find((o) => o.status === 'unknown').message).toMatch(/confirme na SAXO/);
  });

  it('recusa tokens da conta real enquanto STOCKS_SAXO_ALLOW_LIVE não estiver activo', async () => {
    await ctx.pool.query("UPDATE user_integration_tokens SET environment = 'live'");
    const f = useSaxo();
    const res = await ana.get('/saxo/connection');
    expect(res.json().error.code).toBe('SAXO_LIVE_BLOCKED');
    expect(f.calls).toHaveLength(0);
    expect((await preview()).json().error.code).toBe('SAXO_LIVE_BLOCKED');
  });

  it('«Testar ligação» devolve conta e saldo da simulação', async () => {
    expect((await ana.get('/saxo/connection')).json()).toEqual({
      environment: 'sim', accountId: '0000000', currency: 'EUR', isTrial: true, cashBalance: 1000000, totalValue: 1000000,
    });
  });

  it('pré-valida: resolve o instrumento por ISIN e MIC, corre o precheck e devolve um código de confirmação', async () => {
    const f = useSaxo();
    const res = await preview();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true, environment: 'sim', side: 'buy', quantity: 10, orderType: 'limit', limitPrice: '9.5', estimatedAmount: '95.00', currency: 'EUR',
      instrument: { id: galp, saxoSymbol: 'GALP:xlis', uic: 23737 }, appPrice: '10.000000',
    });
    expect(res.json().confirmation).toMatch(/^\d+\./);
    expect(f.calls.find((c) => c.key === 'GET /ref/v1/instruments').query.Keywords).toBe('PTGAL0AM0009');
    expect(f.calls.find((c) => c.key === 'POST /trade/v2/orders/precheck').body).toMatchObject({
      Uic: 23737, AssetType: 'Stock', BuySell: 'Buy', Amount: 10, OrderType: 'Limit', OrderPrice: 9.5, ManualOrder: true, OrderDuration: { DurationType: 'DayOrder' },
    });
    const [[r]] = await ctx.pool.query('SELECT uic, saxo_symbol, order_types FROM saxo_instruments WHERE instrument_id = ?', [galp]);
    expect(Number(r.uic)).toBe(23737);
    expect(r.order_types).toContain('Limit');
    // Segunda vez: a correspondência já está guardada, não volta a pesquisar.
    const g = useSaxo();
    await preview();
    expect(g.calls.some((c) => c.key === 'GET /ref/v1/instruments')).toBe(false);
  });

  it('uma pré-validação não aceite pela SAXO não dá código de confirmação', async () => {
    useSaxo({ 'POST /trade/v2/orders/precheck': { status: 200, body: { PreCheckResult: 'Error', ErrorInfo: { Message: 'Saldo insuficiente' } } } });
    expect((await preview()).json()).toMatchObject({ ok: false, problem: 'Saldo insuficiente', confirmation: null });
  });

  it('várias correspondências: devolve candidatos e a escolha fica guardada', async () => {
    const two = fx('instruments-galp');
    two.body.Data.push({ ...two.body.Data[0], Identifier: 999, Symbol: 'GALP:xmce', ExchangeId: 'SIBE' });
    await ctx.pool.query('UPDATE instruments SET mic = NULL WHERE id = ?', [galp]);
    useSaxo({ 'GET /ref/v1/instruments': two });
    const res = await preview();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'SAXO_AMBIGUOUS' });
    expect(res.json().error.details.candidates.map((c) => c.uic)).toEqual([23737, 999]);
    const choose = await ana.post(`/saxo/instruments/${galp}/match`, { uic: 23737 });
    expect(choose.json()).toEqual({ uic: 23737, symbol: 'GALP:xlis' });
    expect((await preview()).statusCode).toBe(200);
  });

  it('instrumento que não existe na SAXO → 422', async () => {
    useSaxo({ 'GET /ref/v1/instruments': { status: 200, body: { Data: [] } } });
    expect((await preview()).json().error.code).toBe('SAXO_INSTRUMENT_NOT_FOUND');
  });

  it('envia a ordem com o código, regista-a e audita sem o token', async () => {
    const f = useSaxo();
    const res = await place();
    expect(res.statusCode).toBe(201);
    expect(res.json().order).toMatchObject({ saxoOrderId: '5041484162', status: 'working', side: 'buy', quantity: 10, orderType: 'limit', limitPrice: '9.500000', symbol: 'GALP.LS', environment: 'sim' });
    const sent = f.calls.find((c) => c.key === 'POST /trade/v2/orders');
    expect(sent.body).toMatchObject({ Uic: 23737, Amount: 10, OrderPrice: 9.5, ManualOrder: true });
    expect(sent.headers['x-request-id']).toMatch(/^ordem-teste-/);
    const [audits] = await ctx.pool.query("SELECT detail FROM audit_log WHERE action = 'saxo.order_placed'");
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(TOKEN);
  });

  it('o código está ligado aos parâmetros: alterar quantidade, lado, preço ou tipo é recusado', async () => {
    const p = (await preview()).json();
    for (const change of [{ quantity: 11 }, { side: 'sell' }, { limitPrice: '9.6' }, { orderType: 'market' }]) {
      const res = await ana.post('/saxo/orders', { ...base(), ...change, confirmation: p.confirmation, idempotencyKey: `ordem-x-${++seq}-aaaa` });
      expect(res.statusCode, JSON.stringify(change)).toBe(409);
      expect(res.json().error.code).toBe('SAXO_BAD_CONFIRMATION');
    }
    expect((await ana.post('/saxo/orders', { ...base(), confirmation: 'abc.def.ghi-jkl', idempotencyKey: 'ordem-y-aaaaaa' })).statusCode).toBe(409);
    const [[{ n }]] = await ctx.pool.query('SELECT COUNT(*) AS n FROM saxo_orders');
    expect(Number(n)).toBe(0);
  });

  it('um código expirado é recusado e o de outro utilizador também', async () => {
    const p = (await preview()).json();
    const old = `${Date.now() - 1000}.${p.confirmation.split('.')[1]}`;
    expect((await ana.post('/saxo/orders', { ...base(), confirmation: old, idempotencyKey: 'ordem-e-aaaaaa' })).statusCode).toBe(409);
    await saveToken(ruiId);
    const res = await rui.post('/saxo/orders', { ...base(), confirmation: p.confirmation, idempotencyKey: 'ordem-r-aaaaaa' });
    expect(res.json().error.code).toMatch(/SAXO_BAD_CONFIRMATION|SAXO_NO/);
  });

  it('a mesma idempotencyKey nunca envia duas ordens', async () => {
    const p = (await preview()).json();
    const body = { ...base(), confirmation: p.confirmation, idempotencyKey: 'ordem-repetida-1' };
    const f = useSaxo();
    expect((await ana.post('/saxo/orders', body)).statusCode).toBe(201);
    const again = await ana.post('/saxo/orders', body);
    expect(again.statusCode).toBe(200);
    expect(again.json().replayed).toBe(true);
    expect(f.calls.filter((c) => c.key === 'POST /trade/v2/orders')).toHaveLength(1);
  });

  it('ordem recusada pela SAXO fica registada como rejeitada; sem resposta fica «unknown»', async () => {
    useSaxo({ 'POST /trade/v2/orders': { status: 400, body: { ErrorInfo: { Message: 'Mercado fechado' } } } });
    const res = await place();
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe('Mercado fechado');
    useSaxo({ 'POST /trade/v2/orders': { status: 503, body: {} } });
    expect((await place()).statusCode).toBe(502);
    const [rows] = await ctx.pool.query('SELECT status, message FROM saxo_orders ORDER BY id');
    expect(rows.map((r) => r.status)).toEqual(['rejected', 'unknown']);
    expect(rows[1].message).toMatch(/confirme na SAXO/);
  });

  it('um 409 de duplicado da SAXO não reenvia', async () => {
    const f = useSaxo({ 'POST /trade/v2/orders': { status: 409, body: {} } });
    expect((await place()).json().error.code).toBe('SAXO_DUPLICATE');
    expect(f.calls.filter((c) => c.key === 'POST /trade/v2/orders')).toHaveLength(1);
  });

  it('lista as ordens do utilizador com o estado da SAXO e marca como terminadas as que já não estão abertas', async () => {
    await place();
    let list = (await ana.get('/saxo/orders')).json();
    expect(list).toMatchObject({ total: 1, refreshError: null });
    expect(list.items[0].status).toBe('working');
    useSaxo({ 'GET /port/v1/orders/me': fx('orders-empty') });
    list = (await ana.get('/saxo/orders')).json();
    expect(list.items[0].status).toBe('ended');
    // Outro utilizador não as vê.
    expect((await rui.get('/saxo/orders')).json().total).toBe(0);
  });

  it('cancela uma ordem aberta; não cancela as outras', async () => {
    const id = (await place()).json().order.id;
    useSaxo();
    const res = await ana.del(`/saxo/orders/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
    expect((await ana.del(`/saxo/orders/${id}`)).json().error.code).toBe('SAXO_NOT_CANCELLABLE');
    expect((await ana.del('/saxo/orders/9999')).statusCode).toBe(404);
  });

  it('recusa um preço limite fora do passo de preço e sugere o mais próximo', async () => {
    const res = await preview({ limitPrice: '9.5004' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'SAXO_TICK_SIZE', details: { tickSize: 0.002, suggested: '9.5' } });
    expect((await preview({ limitPrice: '9.504' })).statusCode).toBe(200);
    // O código só existe para preços válidos: usá-lo com um preço fora do passo é recusado.
    const p = (await preview()).json();
    expect((await ana.post('/saxo/orders', { ...base(), limitPrice: '9.5004', confirmation: p.confirmation, idempotencyKey: 'ordem-tick-aaaa' })).statusCode).toBe(409);
  });

  it('uma correspondência guardada sem passo de preço é actualizada na pré-validação', async () => {
    await preview();
    await ctx.pool.query('UPDATE saxo_instruments SET tick_scheme = NULL');
    expect((await preview({ limitPrice: '9.5004' })).json().error.code).toBe('SAXO_TICK_SIZE');
    const [[r]] = await ctx.pool.query('SELECT tick_scheme FROM saxo_instruments');
    expect(r.tick_scheme).toContain('DefaultTickSize');
  });

  it('Carteira SAXO: saldo e posições valorizadas ao último preço da aplicação (o SIM não tem preços)', async () => {
    useSaxo({ 'GET /port/v1/positions/me': fx('positions-synthetic') });
    let res = await ana.get('/saxo/portfolio');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accountId: '0000000', cashBalance: 1000000, totalValue: 1000000 });
    // Sem correspondência guardada: usa o símbolo da SAXO e não inventa valor.
    expect(res.json().positions).toEqual([{
      positionId: '1000001', instrumentId: null, symbol: 'GALP:xlis', name: 'Galp Energia SGPS SA', currency: 'EUR',
      quantity: 100, openPrice: 30, price: null, marketValue: null, pnl: null,
    }]);
    await preview(); // guarda a correspondência (Uic 23737 → GALP.LS, último preço 10)
    useSaxo({ 'GET /port/v1/positions/me': fx('positions-synthetic') });
    res = await ana.get('/saxo/portfolio');
    expect(res.json().positions[0]).toMatchObject({ instrumentId: galp, symbol: 'GALP.LS', price: 10, marketValue: 1000, pnl: -2000 });
    useSaxo({ 'GET /port/v1/positions/me': fx('positions-empty') });
    expect((await ana.get('/saxo/portfolio')).json().positions).toEqual([]);
  });

  it('Alertas SAXO: uma ordem que deixa de estar aberta gera um só aviso, mesmo com várias consultas', async () => {
    await place();
    expect((await ana.get('/saxo/alerts')).json()).toMatchObject({ emailEnabled: true, items: [] });
    useSaxo({ 'GET /port/v1/orders/me': fx('orders-empty') });
    expect((await ana.get('/saxo/orders')).json().items[0].status).toBe('ended');
    await ana.get('/saxo/orders');
    const a = (await ana.get('/saxo/alerts')).json();
    expect(a.items).toHaveLength(1);
    expect(a.items[0]).toMatchObject({ kind: 'ended', symbol: 'GALP.LS', side: 'buy', quantity: 10, limitPrice: '9.500000', saxoOrderId: '5041484162', read: false, emailedAt: null });
    expect((await ana.post('/saxo/alerts/read')).statusCode).toBe(204);
    expect((await ana.get('/saxo/alerts')).json().items[0].read).toBe(true);
    expect((await rui.get('/saxo/alerts')).json().items).toEqual([]);
  });

  it('a vigia confronta as ordens abertas com a SAXO sem a página aberta', async () => {
    await place();
    useSaxo({ 'GET /port/v1/orders/me': fx('orders-empty') });
    expect(await watchOrders(ctx.pool, ctx.cfg)).toBe(1);
    expect(await watchOrders(ctx.pool, ctx.cfg)).toBe(0); // já não há ordens abertas: nem chama a SAXO
    expect((await ana.get('/saxo/alerts')).json().items).toHaveLength(1);
  });

  it('a preferência de email guarda-se por utilizador', async () => {
    expect((await ana.put('/saxo/alerts/settings', { emailEnabled: false })).json()).toEqual({ emailEnabled: false });
    expect((await ana.get('/saxo/alerts')).json().emailEnabled).toBe(false);
    expect((await rui.get('/saxo/alerts')).json().emailEnabled).toBe(true);
    expect((await ana.put('/saxo/alerts/settings', { emailEnabled: 'sim' })).statusCode).toBe(400);
  });

  describe('ligação OAuth (Authorization Code)', () => {
    const APP = { appKey: 'chave-da-app-0123', appSecret: 'segredo-da-app-9876' };
    const tok = (n) => ({ status: 200, body: { access_token: `acesso-${n}`, token_type: 'Bearer', expires_in: 1200, refresh_token: `refresh-${n}`, refresh_token_expires_in: 2400 } });
    const tokenCalls = (f) => f.calls.filter((c) => c.key === 'POST /token');
    const saveApp = () => ana.put('/me/integrations/saxo/app', APP);
    const stateFrom = async () => signState(ctx.cfg, anaId); // o endpoint «connect» tem limite de pedidos; é testado à parte
    const callback = (query) => ctx.app.inject({ method: 'GET', url: `/api/v1/integrations/saxo/callback?${new URLSearchParams(query)}` });
    /** Liga por OAuth como o browser: connect → (SAXO) → callback com o state. */
    const putApp = () => ctx.pool.query('REPLACE INTO user_saxo_apps (user_id, app_key, app_secret_enc) VALUES (?, ?, ?)', [anaId, APP.appKey, encryptSecret(TEST_SECRET_KEY, APP.appSecret)]);
    async function connect(f) {
      await putApp(); // directo na BD: o PUT tem limite de pedidos por minuto
      const res = await callback({ code: 'codigo-1', state: await stateFrom() });
      expect(res.headers.location).toBe('/definicoes?saxo=ok');
      return f;
    }
    beforeEach(async () => {
      ctx.cfg.publicOrigin = 'https://stocks.test';
      await ctx.pool.query('DELETE FROM user_integration_tokens');
    });
    afterEach(() => { ctx.cfg.publicOrigin = ''; });

    it('guarda a aplicação cifrada, sem nunca devolver o segredo', async () => {
      const res = await saveApp();
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ app: { appKey: APP.appKey, hasSecret: true }, redirectUri: 'https://stocks.test/api/v1/integrations/saxo/callback', canConnect: true });
      expect(res.body).not.toContain(APP.appSecret);
      const [[row]] = await ctx.pool.query('SELECT app_secret_enc FROM user_saxo_apps');
      expect(row.app_secret_enc).toMatch(/^v1:/);
      expect(decryptSecret(TEST_SECRET_KEY, row.app_secret_enc)).toBe(APP.appSecret);
      // Sem segredo mantém o guardado (mesma chave); outra chave exige segredo.
      expect((await ana.put('/me/integrations/saxo/app', { appKey: APP.appKey })).statusCode).toBe(200);
      expect((await ana.put('/me/integrations/saxo/app', { appKey: 'outra-chave-0001' })).json().error.code).toBe('SECRET_REQUIRED');
      const [audits] = await ctx.pool.query("SELECT detail FROM audit_log WHERE action = 'integration.app_set'");
      expect(JSON.stringify(audits)).not.toContain(APP.appSecret);
      expect((await rui.get('/me/integrations/saxo')).json().app).toBeNull();
    });

    it('«Ligar» devolve o endereço de autorização com chave, URL de retorno e state', async () => {
      expect((await ana.post('/me/integrations/saxo/connect', {})).json().error.code).toBe('NO_SAXO_APP');
      await saveApp();
      const u = new URL((await ana.post('/me/integrations/saxo/connect', {})).json().url);
      expect(u.origin + u.pathname).toBe('https://sim.logonvalidation.net/authorize');
      expect(Object.fromEntries(u.searchParams)).toMatchObject({
        response_type: 'code', client_id: APP.appKey, redirect_uri: 'https://stocks.test/api/v1/integrations/saxo/callback',
      });
      expect(u.searchParams.get('state')).toMatch(/^\d+\.\d+\./);
      expect(u.href).not.toContain(APP.appSecret);
    });

    it('o retorno troca o código por tokens (cifrados) e fica ligado com renovação automática', async () => {
      const f = useSaxo({ 'POST /token': tok(1) });
      await connect(f);
      const call = tokenCalls(f)[0];
      expect(call.headers.Authorization).toBe(`Basic ${Buffer.from(`${APP.appKey}:${APP.appSecret}`).toString('base64')}`);
      expect(call.body).toEqual({ grant_type: 'authorization_code', code: 'codigo-1', redirect_uri: 'https://stocks.test/api/v1/integrations/saxo/callback' });
      const [[row]] = await ctx.pool.query('SELECT * FROM user_integration_tokens');
      expect(row).toMatchObject({ auth_kind: 'oauth', environment: 'sim', rejected_at: null });
      expect(decryptSecret(TEST_SECRET_KEY, row.token_enc)).toBe('acesso-1');
      expect(decryptSecret(TEST_SECRET_KEY, row.refresh_token_enc)).toBe('refresh-1');
      expect(row.token_enc).not.toContain('acesso-1');
      const s = (await ana.get('/me/integrations/saxo')).json();
      expect(s).toMatchObject({ configured: true, kind: 'oauth', expired: false, expiresAt: null });
      expect(JSON.stringify(s)).not.toMatch(/acesso-1|refresh-1/);
      // E já se pode usar.
      useSaxo({ 'POST /token': tok(2) });
      expect((await ana.get('/saxo/connection')).statusCode).toBe(200);
    });

    it('recusa retornos com state inválido, adulterado, expirado ou sem código; nada é trocado', async () => {
      const f = useSaxo({ 'POST /token': tok(1) });
      await putApp();
      const good = await stateFrom();
      const [id, exp, nonce, mac] = good.split('.');
      const cases = [
        { code: 'x', state: 'lixo' }, { code: 'x' }, { code: 'x', state: `${id}.${exp}.${nonce}.${mac.slice(0, -2)}aa` },
        { code: 'x', state: `${Number(id) + 1}.${exp}.${nonce}.${mac}` }, { code: 'x', state: `${id}.${Date.now() - 1000}.${nonce}.${mac}` },
      ];
      for (const q of cases) {
        const res = await callback(q);
        expect(res.headers.location, JSON.stringify(q)).toMatch(/^\/definicoes\?saxo=erro&motivo=/);
      }
      expect((await callback({ state: good, error: 'access_denied' })).headers.location).toContain('recusada');
      expect((await callback({ state: good })).headers.location).toContain('saxo=erro');
      expect(tokenCalls(f)).toHaveLength(0);
      expect((await ana.get('/me/integrations/saxo')).json().configured).toBe(false);
    });

    it('um código recusado pela SAXO não liga nada e a mensagem não traz o segredo', async () => {
      useSaxo({ 'POST /token': { status: 400, body: { error: 'invalid_grant', error_description: 'code expired' } } });
      await putApp();
      const res = await callback({ code: 'velho', state: await stateFrom() });
      const loc = decodeURIComponent(res.headers.location);
      expect(loc).toContain('saxo=erro');
      expect(loc).toContain('invalid_grant');
      expect(loc).not.toContain(APP.appSecret);
      expect((await ana.get('/me/integrations/saxo')).json().configured).toBe(false);
    });

    it('renova o access token quando expira, com o refresh token, e guarda os dois novos', async () => {
      await connect(useSaxo({ 'POST /token': tok(1) }));
      await ctx.pool.query('UPDATE user_integration_tokens SET expires_at = NOW(3) - INTERVAL 1 MINUTE');
      const f = useSaxo({ 'POST /token': tok(2) });
      expect((await ana.get('/saxo/connection')).statusCode).toBe(200);
      expect(tokenCalls(f)).toHaveLength(1);
      expect(tokenCalls(f)[0].body).toEqual({ grant_type: 'refresh_token', refresh_token: 'refresh-1' });
      expect(f.calls.find((c) => c.key === 'GET /port/v1/accounts/me').headers.Authorization).toBe('Bearer acesso-2');
      const [[row]] = await ctx.pool.query('SELECT token_enc, refresh_token_enc FROM user_integration_tokens');
      expect(decryptSecret(TEST_SECRET_KEY, row.token_enc)).toBe('acesso-2');
      expect(decryptSecret(TEST_SECRET_KEY, row.refresh_token_enc)).toBe('refresh-2');
      // Ainda válido: não renova outra vez.
      const g = useSaxo({ 'POST /token': tok(3) });
      await ana.get('/saxo/connection');
      expect(tokenCalls(g)).toHaveLength(0);
    });

    it('pedidos em simultâneo gastam o refresh token uma só vez (troca atómica)', async () => {
      await connect(useSaxo({ 'POST /token': tok(1) }));
      await ctx.pool.query('UPDATE user_integration_tokens SET expires_at = NOW(3) - INTERVAL 1 MINUTE');
      let n = 1;
      const f = useSaxo({ 'POST /token': () => tok(++n) });
      const results = await Promise.all([ana.get('/saxo/connection'), ana.get('/saxo/connection'), ana.get('/saxo/connection')]);
      expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      expect(tokenCalls(f)).toHaveLength(1);
    });

    it('refresh token recusado: a ligação fica marcada como expirada e não insiste', async () => {
      await connect(useSaxo({ 'POST /token': tok(1) }));
      await ctx.pool.query('UPDATE user_integration_tokens SET expires_at = NOW(3) - INTERVAL 1 MINUTE');
      const f = useSaxo({ 'POST /token': { status: 400, body: { error: 'invalid_grant' } } });
      expect((await ana.get('/saxo/connection')).json().error.code).toBe('SAXO_TOKEN_EXPIRED');
      expect((await ana.get('/saxo/connection')).json().error.code).toBe('SAXO_TOKEN_EXPIRED');
      expect(tokenCalls(f)).toHaveLength(1);
      expect((await ana.get('/me/integrations/saxo')).json()).toMatchObject({ configured: true, expired: true });
    });

    it('falha de rede ou 5xx na renovação não gasta a ligação: tenta-se de novo depois', async () => {
      await connect(useSaxo({ 'POST /token': tok(1) }));
      await ctx.pool.query('UPDATE user_integration_tokens SET expires_at = NOW(3) - INTERVAL 1 MINUTE');
      useSaxo({ 'POST /token': { status: 503, body: {} } });
      expect((await ana.get('/saxo/connection')).json().error.code).toBe('SAXO_UNAVAILABLE');
      expect((await ana.get('/me/integrations/saxo')).json().expired).toBe(false);
      useSaxo({ 'POST /token': tok(2) });
      expect((await ana.get('/saxo/connection')).statusCode).toBe(200);
    });

    it('a renovação antecipada mantém viva a ligação mesmo sem uso', async () => {
      await connect(useSaxo({ 'POST /token': tok(1) }));
      await ctx.pool.query('UPDATE user_integration_tokens SET expires_at = NOW(3) + INTERVAL 2 MINUTE');
      const f = useSaxo({ 'POST /token': tok(2) });
      expect(await refreshDueTokens(ctx.pool, ctx.cfg)).toBe(1);
      expect(tokenCalls(f)).toHaveLength(1);
      expect(await refreshDueTokens(ctx.pool, ctx.cfg)).toBe(0); // agora tem 20 min
    });

    it('desligar remove os tokens mas mantém a aplicação; remover a aplicação remove a ligação', async () => {
      await connect(useSaxo({ 'POST /token': tok(1) }));
      expect((await ana.del('/me/integrations/saxo')).statusCode).toBe(204);
      expect((await ana.get('/me/integrations/saxo')).json()).toMatchObject({ configured: false, app: { appKey: APP.appKey } });
      await connect(useSaxo({ 'POST /token': tok(1) }));
      expect((await ana.del('/me/integrations/saxo/app')).statusCode).toBe(204);
      expect((await ana.get('/me/integrations/saxo')).json()).toMatchObject({ configured: false, app: null });
    });

    it('guardar um token de 24 h substitui a ligação OAuth', async () => {
      await connect(useSaxo({ 'POST /token': tok(1) }));
      expect((await ana.put('/me/integrations/saxo', { token: TOKEN })).json()).toMatchObject({ kind: 'manual', expired: false });
      const [[row]] = await ctx.pool.query('SELECT refresh_token_enc FROM user_integration_tokens');
      expect(row.refresh_token_enc).toBeNull();
    });
  });

  it('valida quantidade e preço limite', async () => {
    expect((await preview({ quantity: 0 })).statusCode).toBe(400);
    expect((await preview({ quantity: 1.5 })).statusCode).toBe(400);
    expect((await preview({ limitPrice: undefined })).json().error.code).toBe('LIMIT_PRICE_REQUIRED');
    expect((await preview({ limitPrice: '-1' })).statusCode).toBe(400);
  });
});

describe('passo de preço', () => {
  const scheme = fx('instrument-details-galp').body.TickSizeScheme;
  it('escolhe o escalão pelo preço e valida múltiplos do passo', async () => {
    const { tickFor, isOnTick, nearestTick } = await import('../src/saxo/ticks.js');
    expect(tickFor(scheme, 15)).toBe(0.005);
    expect(tickFor(scheme, 30)).toBe(0.01);
    expect(tickFor(scheme, 30000)).toBe(10);
    expect(tickFor(scheme, 60000)).toBe(20); // acima do último escalão: passo por omissão
    expect(isOnTick(scheme, 30.01)).toBe(true);
    expect(isOnTick(scheme, 30.005)).toBe(false);
    expect(isOnTick(scheme, 15.005)).toBe(true);
    expect(isOnTick(scheme, 15.003)).toBe(false);
    expect(isOnTick(null, 1.2345)).toBe(true);
    expect(nearestTick(scheme, 30.006)).toBe('30.01');
    expect(nearestTick(scheme, 15.002)).toBe('15');
    expect(nearestTick(scheme, 0.00001)).toBe('0.0001');
  });
});
