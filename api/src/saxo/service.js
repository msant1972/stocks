import { createHmac, timingSafeEqual } from 'node:crypto';
import { audit } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { suggestMic } from '../orderbook/index.js';
import { decryptSecret } from '../secrets.js';
import { ageInDays } from '../services/quotes.js';
import { createSaxoClient, errorText } from './client.js';
import * as E from './errors.js';
import { isOnTick, nearestTick, tickFor } from './ticks.js';
import { refreshUserToken } from './tokens.js';

const PROVIDER = 'saxo';
const CONFIRM_TTL_MS = 5 * 60_000;
const exchangeCache = new Map(); // baseUrl -> { at, map: ExchangeId -> MIC }

/** Cliente da SAXO para o token do utilizador, ou o erro que explica porque não há (sem token, expirado, LIVE). */
export async function openSession(pool, cfg, userId) {
  const load = async () => (await pool.query(
    'SELECT token_enc, environment, auth_kind, expires_at, rejected_at FROM user_integration_tokens WHERE user_id = ? AND provider = ?',
    [userId, PROVIDER],
  ))[0][0];
  let row = await load();
  if (!row) throw E.noToken();
  if (row.environment === 'live' && !cfg.saxo.allowLive) throw E.liveBlocked();
  // O access token dura minutos; renova-se (de forma atómica) quando está a acabar.
  if (!row.rejected_at && (!row.expires_at || row.expires_at.getTime() < Date.now() + 30_000)) {
    await refreshUserToken(pool, cfg, userId);
    row = await load();
    if (!row) throw E.noToken();
  }
  if (row.rejected_at || (row.expires_at && row.expires_at.getTime() < Date.now())) throw E.tokenExpired();
  let token;
  try { token = decryptSecret(cfg.secretKey, row.token_enc); } catch { throw E.noToken(); }
  const environment = row.environment;
  const client = createSaxoClient({
    baseUrl: environment === 'live' ? cfg.saxo.liveUrl : cfg.saxo.simUrl,
    token, fetchImpl: cfg.saxo.fetchImpl, timeoutMs: cfg.saxo.timeoutMs, sleep: cfg.saxo.sleep ?? undefined,
    onUnauthorized: () => pool.query('UPDATE user_integration_tokens SET rejected_at = NOW(3), updated_at = updated_at WHERE user_id = ? AND provider = ?', [userId, PROVIDER]),
  });
  return { client, environment, userId };
}

/** Conta da SAXO onde se negoceia: a primeira activa na moeda da aplicação. */
export async function pickAccount(client, currency = 'EUR') {
  const res = await client.get('/port/v1/accounts/me');
  const acc = (res?.Data ?? []).find((a) => a.Active && a.Currency === currency);
  if (!acc) throw new AppError(409, 'SAXO_NO_ACCOUNT', `não há conta activa em ${currency} na SAXO Bank`);
  return { accountKey: acc.AccountKey, accountId: acc.AccountId, currency: acc.Currency, isTrial: Boolean(acc.IsTrialAccount) };
}

/** «Testar ligação»: conta e saldo. */
export async function testConnection(session) {
  const account = await pickAccount(session.client);
  const bal = await session.client.get('/port/v1/balances/me');
  return {
    environment: session.environment, accountId: account.accountId, currency: account.currency, isTrial: account.isTrial,
    cashBalance: bal?.CashBalance ?? null, totalValue: bal?.TotalValue ?? null,
  };
}

async function exchangeMics(client, baseKey) {
  const hit = exchangeCache.get(baseKey);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.map;
  const map = new Map();
  try {
    const res = await client.get('/ref/v1/exchanges', { $top: 1000 });
    for (const e of res?.Data ?? []) if (e.ExchangeId && e.Mic) map.set(e.ExchangeId, e.Mic);
    if (map.size) exchangeCache.set(baseKey, { at: Date.now(), map });
  } catch (err) {
    if (err.code === 'SAXO_TOKEN_EXPIRED') throw err; // sem mapa, a escolha cai para a raiz do símbolo
  }
  return map;
}

const candidate = (c, mics) => ({
  uic: Number(c.Identifier), symbol: c.Symbol, description: c.Description ?? null, exchangeId: c.ExchangeId ?? null,
  mic: mics.get(c.ExchangeId) ?? null, currency: c.CurrencyCode ?? null,
});

async function loadInstrument(pool, instrumentId) {
  const [[inst]] = await pool.query(
    'SELECT id, symbol, name, exchange, currency, status, isin, mic FROM instruments WHERE id = ?', [instrumentId],
  );
  if (!inst) throw notFound('Instrumento');
  if (inst.status !== 'active') throw new AppError(409, 'INSTRUMENT_NOT_ACTIVE', 'o instrumento ainda não está activo ou é inválido');
  return inst;
}

async function storedResolution(pool, instrumentId, environment) {
  const [[r]] = await pool.query('SELECT * FROM saxo_instruments WHERE instrument_id = ? AND environment = ?', [instrumentId, environment]);
  return r ?? null;
}

/** Guarda a correspondência escolhida, depois de confirmar nos detalhes da SAXO que é negociável e na moeda certa. */
async function saveResolution(pool, session, inst, cand, accountKey, source) {
  const d = await session.client.get(`/ref/v1/instruments/details/${cand.uic}/Stock`, { AccountKey: accountKey });
  if (d?.IsTradable === false) throw new AppError(409, 'SAXO_NOT_TRADABLE', `${cand.symbol} não é negociável na conta da SAXO Bank`);
  const currency = d?.CurrencyCode ?? cand.currency;
  if (currency !== inst.currency) throw new AppError(409, 'CURRENCY_MISMATCH', `${cand.symbol} negoceia em ${currency}, não em ${inst.currency}`);
  const types = (d?.SupportedOrderTypes ?? []).join(',');
  await pool.query(
    `REPLACE INTO saxo_instruments (instrument_id, environment, uic, asset_type, saxo_symbol, exchange_id, currency, description, tradable, order_types, min_size, tick_scheme, source)
     VALUES (?, ?, ?, 'Stock', ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [inst.id, session.environment, cand.uic, d?.Symbol ?? cand.symbol, cand.exchangeId, currency, (d?.Description ?? cand.description ?? '').slice(0, 255),
      types.slice(0, 255), d?.MinimumTradeSize ?? 1, d?.TickSizeScheme ? JSON.stringify(d.TickSizeScheme) : null, source],
  );
  return storedResolution(pool, inst.id, session.environment);
}

/**
 * Instrumento da SAXO que corresponde ao da aplicação: ISIN (pesquisa por palavra-chave) ou raiz do símbolo, filtrado
 * pela bolsa (MIC). Se não houver uma só correspondência, 409 SAXO_AMBIGUOUS com os candidatos para o utilizador escolher.
 */
export async function resolveInstrument(pool, session, inst, accountKey) {
  const known = await storedResolution(pool, inst.id, session.environment);
  if (known) return known;
  const mic = inst.mic ?? suggestMic(inst.exchange);
  const root = inst.symbol.split('.')[0];
  const mics = await exchangeMics(session.client, session.environment);
  const search = async (kw) => (await session.client.get('/ref/v1/instruments', { Keywords: kw, AssetTypes: 'Stock', $top: 50 }))?.Data ?? [];
  let found = inst.isin ? await search(inst.isin) : [];
  if (!found.length) found = await search(root);
  const cands = found.filter((c) => c.AssetType === 'Stock' && c.CurrencyCode === inst.currency).map((c) => candidate(c, mics));
  if (!cands.length) throw new AppError(422, 'SAXO_INSTRUMENT_NOT_FOUND', `${inst.symbol} não foi encontrado na SAXO Bank`);

  const wantSymbol = mic ? `${root}:${mic}`.toLowerCase() : null;
  let pool1 = mic ? cands.filter((c) => c.mic === mic) : [];
  if (!pool1.length && wantSymbol) pool1 = cands.filter((c) => c.symbol.toLowerCase() === wantSymbol);
  if (pool1.length > 1 && wantSymbol) {
    const exact = pool1.filter((c) => c.symbol.toLowerCase() === wantSymbol);
    if (exact.length === 1) pool1 = exact;
  }
  if (pool1.length === 1) return saveResolution(pool, session, inst, pool1[0], accountKey, 'auto');
  throw new AppError(409, 'SAXO_AMBIGUOUS', `há várias correspondências para ${inst.symbol} na SAXO Bank; escolha o instrumento certo`, {
    candidates: (pool1.length ? pool1 : cands).slice(0, 10),
  });
}

/** Escolha manual de um candidato (revalidado na SAXO por pesquisa). */
export async function chooseInstrument(pool, session, instrumentId, uic) {
  const inst = await loadInstrument(pool, instrumentId);
  const account = await pickAccount(session.client, inst.currency);
  const d = await session.client.get(`/ref/v1/instruments/details/${Number(uic)}/Stock`, { AccountKey: account.accountKey });
  if (!d?.Uic) throw new AppError(422, 'SAXO_INSTRUMENT_NOT_FOUND', 'instrumento não encontrado na SAXO Bank');
  const mics = await exchangeMics(session.client, session.environment);
  const cand = { uic: Number(d.Uic), symbol: d.Symbol, description: d.Description, exchangeId: d.Exchange?.ExchangeId ?? null, mic: mics.get(d.Exchange?.ExchangeId) ?? null, currency: d.CurrencyCode };
  return saveResolution(pool, session, inst, cand, account.accountKey, 'manual');
}

/** Último preço da aplicação (a referência da pré-visualização; o SIM não tem preços). */
async function appQuote(pool, instrumentId, maxAgeDays) {
  const [[q]] = await pool.query('SELECT session_date, close FROM daily_quotes WHERE instrument_id = ? ORDER BY session_date DESC LIMIT 1', [instrumentId]);
  if (!q) throw new AppError(409, 'NO_QUOTE', 'não há cotações disponíveis para este instrumento');
  if (ageInDays(q.session_date) > maxAgeDays) {
    throw new AppError(409, 'STALE_QUOTE', `a última cotação (${q.session_date}) tem mais de ${maxAgeDays} dias`, { quoteDate: q.session_date });
  }
  return { price: String(q.close), date: q.session_date };
}

const canonPrice = (p) => (p == null || p === '' ? '' : String(Number(p)));

function confirmationMac(cfg, parts) {
  const key = createHmac('sha256', cfg.secretKey).update('saxo-order-confirm').digest();
  return createHmac('sha256', key).update(JSON.stringify(parts)).digest('base64url');
}

function signParams(cfg, userId, p, uic, environment, exp) {
  return confirmationMac(cfg, [userId, p.instrumentId, uic, environment, p.side, p.quantity, p.orderType, canonPrice(p.limitPrice), exp]);
}

function checkConfirmation(cfg, userId, p, uic, environment, code) {
  const [expText, mac] = String(code ?? '').split('.');
  const exp = Number(expText);
  const bad = () => new AppError(409, 'SAXO_BAD_CONFIRMATION', 'a pré-validação não corresponde a esta ordem; pré-valide de novo');
  if (!Number.isFinite(exp) || !mac) throw bad();
  if (exp < Date.now()) throw new AppError(409, 'SAXO_CONFIRMATION_EXPIRED', 'a pré-validação expirou; pré-valide de novo');
  const want = Buffer.from(signParams(cfg, userId, p, uic, environment, exp));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw bad();
}

function orderBody(accountKey, saxo, p) {
  const body = {
    AccountKey: accountKey, Uic: Number(saxo.uic), AssetType: saxo.asset_type, BuySell: p.side === 'buy' ? 'Buy' : 'Sell',
    Amount: p.quantity, OrderType: p.orderType === 'limit' ? 'Limit' : 'Market',
    OrderDuration: { DurationType: 'DayOrder' }, ManualOrder: true,
  };
  if (p.orderType === 'limit') body.OrderPrice = Number(p.limitPrice);
  return body;
}

function checkParams(saxo, p) {
  const types = (saxo.order_types ?? '').split(',').filter(Boolean);
  if (types.length && !types.includes(p.orderType === 'limit' ? 'Limit' : 'Market')) {
    throw new AppError(409, 'SAXO_ORDER_TYPE', `este instrumento não aceita ordens ${p.orderType === 'limit' ? 'limitadas' : 'a mercado'}`);
  }
  if (p.orderType === 'limit') {
    let scheme = null;
    try { scheme = saxo.tick_scheme ? JSON.parse(saxo.tick_scheme) : null; } catch { /* esquema ilegível: a SAXO valida */ }
    if (scheme && !isOnTick(scheme, p.limitPrice)) {
      const tick = tickFor(scheme, p.limitPrice);
      const suggested = nearestTick(scheme, p.limitPrice);
      throw new AppError(422, 'SAXO_TICK_SIZE',
        `o preço limite não respeita o passo de preço da bolsa (${tick}); o valor válido mais próximo é ${suggested}`, { tickSize: tick, suggested });
    }
  }
  if (saxo.min_size != null && p.quantity < Number(saxo.min_size)) {
    throw new AppError(422, 'SAXO_MIN_SIZE', `a quantidade mínima é ${Number(saxo.min_size)}`);
  }
}

/**
 * Pré-validação: resolve o instrumento, corre o precheck da SAXO e devolve o resumo com um código de confirmação
 * (assinado, 5 minutos) ligado aos parâmetros exactos. Nada é enviado.
 */
export async function previewOrder(pool, cfg, session, p, { wait }) {
  if (p.orderType === 'limit' && !(Number(p.limitPrice) > 0)) throw new AppError(422, 'LIMIT_PRICE_REQUIRED', 'indique o preço limite');
  const inst = await loadInstrument(pool, p.instrumentId);
  const quote = await appQuote(pool, inst.id, cfg.maxQuoteAgeDays);
  const account = await pickAccount(session.client, inst.currency);
  let saxo = await resolveInstrument(pool, session, inst, account.accountKey);
  if (!saxo.tick_scheme) { // correspondência guardada antes de se registar o passo de preço
    saxo = await saveResolution(pool, session, inst, { uic: Number(saxo.uic), symbol: saxo.saxo_symbol, exchangeId: saxo.exchange_id, description: saxo.description, currency: saxo.currency }, account.accountKey, saxo.source);
  }
  checkParams(saxo, p);

  await wait(session.userId);
  const pre = await session.client.post('/trade/v2/orders/precheck', orderBody(account.accountKey, saxo, p));
  const result = pre?.PreCheckResult ?? 'Unknown';
  const ok = result === 'Ok';
  const refPrice = p.orderType === 'limit' ? p.limitPrice : quote.price;
  const exp = Date.now() + CONFIRM_TTL_MS;
  return {
    environment: session.environment, ok,
    problem: ok ? null : (errorText(pre) ?? `a SAXO Bank não aceitou a ordem (${result})`),
    instrument: { id: inst.id, symbol: inst.symbol, name: inst.name, saxoSymbol: saxo.saxo_symbol, exchangeId: saxo.exchange_id, uic: Number(saxo.uic) },
    account: { id: account.accountId, currency: account.currency, isTrial: account.isTrial },
    side: p.side, quantity: p.quantity, orderType: p.orderType, limitPrice: p.orderType === 'limit' ? canonPrice(p.limitPrice) : null,
    appPrice: quote.price, appPriceDate: quote.date, currency: inst.currency,
    estimatedAmount: (p.quantity * Number(refPrice)).toFixed(2),
    confirmation: ok ? `${exp}.${signParams(cfg, session.userId, p, Number(saxo.uic), session.environment, exp)}` : null,
    expiresAt: new Date(exp).toISOString(),
  };
}

const mapOrder = (r) => ({
  id: Number(r.id), instrumentId: Number(r.instrument_id), symbol: r.symbol ?? null, name: r.name ?? null, environment: r.environment,
  saxoOrderId: r.saxo_order_id, side: r.side, quantity: Number(r.quantity), orderType: r.order_type,
  limitPrice: r.limit_price == null ? null : String(r.limit_price), appPrice: r.app_price == null ? null : String(r.app_price),
  status: r.status, message: r.message, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});

const ORDER_SELECT = `SELECT o.*, i.symbol, i.name FROM saxo_orders o JOIN instruments i ON i.id = o.instrument_id`;

async function orderById(pool, userId, id) {
  const [[r]] = await pool.query(`${ORDER_SELECT} WHERE o.id = ? AND o.user_id = ?`, [id, userId]);
  return r ? mapOrder(r) : null;
}

/** Envia a ordem (depois de verificar o código de confirmação). Repetir a mesma idempotencyKey devolve a ordem original. */
export async function placeOrder(pool, cfg, session, p, { wait }) {
  const userId = session.userId;
  const [[prev]] = await pool.query('SELECT id FROM saxo_orders WHERE user_id = ? AND idempotency_key = ?', [userId, p.idempotencyKey]);
  if (prev) return { order: await orderById(pool, userId, prev.id), replayed: true };

  const inst = await loadInstrument(pool, p.instrumentId);
  const saxo = await storedResolution(pool, inst.id, session.environment);
  if (!saxo) throw new AppError(409, 'SAXO_BAD_CONFIRMATION', 'pré-valide a ordem antes de a enviar');
  checkConfirmation(cfg, userId, p, Number(saxo.uic), session.environment, p.confirmation);
  checkParams(saxo, p);
  const quote = await appQuote(pool, inst.id, cfg.maxQuoteAgeDays);
  const account = await pickAccount(session.client, inst.currency);

  let id;
  try {
    const [res] = await pool.query(
      `INSERT INTO saxo_orders (user_id, instrument_id, environment, idempotency_key, side, quantity, order_type, limit_price, app_price, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending')`,
      [userId, inst.id, session.environment, p.idempotencyKey, p.side, p.quantity, p.orderType, p.orderType === 'limit' ? p.limitPrice : null, quote.price],
    );
    id = res.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new AppError(409, 'SAXO_IN_PROGRESS', 'esta ordem já está a ser enviada');
    throw err;
  }

  const finish = (status, message, saxoOrderId = null) => pool.query(
    'UPDATE saxo_orders SET status = ?, message = ?, saxo_order_id = COALESCE(?, saxo_order_id) WHERE id = ?', [status, message?.slice(0, 500) ?? null, saxoOrderId, id],
  );
  try {
    await wait(userId);
    const res = await session.client.post('/trade/v2/orders', orderBody(account.accountKey, saxo, p), p.idempotencyKey);
    if (!res?.OrderId) throw E.unavailable('a SAXO Bank não devolveu o número da ordem');
    await finish('working', null, String(res.OrderId));
    await audit(pool, userId, 'saxo.order_placed', 'saxo_order', id, {
      environment: session.environment, instrumentId: inst.id, side: p.side, quantity: p.quantity, orderType: p.orderType, saxoOrderId: String(res.OrderId),
    });
  } catch (err) {
    const definitive = err.status === 422 || err.status === 403 || err.status === 409 || err.code === 'SAXO_TOKEN_EXPIRED';
    await finish(definitive ? 'rejected' : 'unknown', definitive ? err.message : 'sem resposta da SAXO Bank: confirme na SAXO se a ordem foi aceite');
    await audit(pool, userId, 'saxo.order_failed', 'saxo_order', id, { code: err.code ?? 'ERROR', status: definitive ? 'rejected' : 'unknown' });
    throw err;
  }
  return { order: await orderById(pool, userId, id), replayed: false };
}

/** Passa uma ordem aberta a «ended» e regista o aviso (uma só vez, mesmo com consultas em simultâneo). Devolve 1 se mudou. */
async function markEnded(pool, userId, id) {
  const [res] = await pool.query(
    "UPDATE saxo_orders SET status = 'ended', message = 'já não está aberta na SAXO (executada, expirada ou cancelada)' WHERE id = ? AND status = 'working'", [id],
  );
  if (!res.affectedRows) return 0;
  await pool.query("INSERT IGNORE INTO saxo_notifications (user_id, order_id, kind) VALUES (?, ?, 'ended')", [userId, id]);
  return 1;
}

/** Ordens do utilizador; as abertas são confrontadas com as ordens abertas da SAXO (as que desapareceram passam a «ended»). */
export async function listOrders(pool, session, { limit = 50, offset = 0 } = {}) {
  const userId = session.userId;
  // Um envio que ficou a meio (a API reiniciou) não pode ficar «a enviar» para sempre: passa a «por confirmar».
  await pool.query(
    "UPDATE saxo_orders SET status = 'unknown', message = 'envio interrompido: confirme na SAXO se a ordem foi aceite' WHERE user_id = ? AND status = 'sending' AND created_at < NOW(3) - INTERVAL 2 MINUTE",
    [userId],
  );
  let refreshError = null;
  let ended = 0; // ordens que passaram a «ended» nesta consulta (geram aviso)
  const [open] = await pool.query("SELECT id, saxo_order_id FROM saxo_orders WHERE user_id = ? AND status = 'working'", [userId]);
  if (open.length && session.client) {
    try {
      const res = await session.client.get('/port/v1/orders/me');
      const live = new Set((res?.Data ?? []).map((o) => String(o.OrderId)));
      const gone = open.filter((o) => !live.has(String(o.saxo_order_id))).map((o) => o.id);
      for (const id of gone) ended += await markEnded(pool, userId, id);
    } catch (err) {
      refreshError = err.message;
    }
  }
  const [rows] = await pool.query(`${ORDER_SELECT} WHERE o.user_id = ? ORDER BY o.id DESC LIMIT ? OFFSET ?`, [userId, limit, offset]);
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM saxo_orders WHERE user_id = ?', [userId]);
  return { items: rows.map(mapOrder), total: Number(total), refreshError, ended };
}

export async function cancelOrder(pool, session, id) {
  const order = await orderById(pool, session.userId, id);
  if (!order) throw notFound('Ordem');
  if (order.status !== 'working' || !order.saxoOrderId) throw new AppError(409, 'SAXO_NOT_CANCELLABLE', 'só se podem cancelar ordens abertas');
  const account = await pickAccount(session.client);
  await session.client.del(`/trade/v2/orders/${encodeURIComponent(order.saxoOrderId)}`, { AccountKey: account.accountKey });
  await pool.query("UPDATE saxo_orders SET status = 'cancelled', message = NULL WHERE id = ?", [id]);
  await audit(pool, session.userId, 'saxo.order_cancelled', 'saxo_order', id, { saxoOrderId: order.saxoOrderId });
  return orderById(pool, session.userId, id);
}

/** Carteira da conta SAXO: saldo e posições. O SIM não tem preços, por isso o valor usa o último preço da aplicação. */
export async function getPortfolio(pool, session) {
  const account = await pickAccount(session.client);
  const bal = await session.client.get('/port/v1/balances/me');
  const pos = await session.client.get('/port/v1/positions/me', { FieldGroups: 'PositionBase,PositionView,DisplayAndFormat' });
  const rows = (pos?.Data ?? []).filter((p) => p.PositionBase?.Status !== 'Closed' && p.PositionBase?.AssetType === 'Stock');
  const uics = [...new Set(rows.map((p) => Number(p.PositionBase.Uic)))];
  const known = new Map();
  if (uics.length) {
    const [m] = await pool.query(
      `SELECT s.uic, i.id, i.symbol, i.name, (SELECT q.close FROM daily_quotes q WHERE q.instrument_id = i.id ORDER BY q.session_date DESC LIMIT 1) AS price
         FROM saxo_instruments s JOIN instruments i ON i.id = s.instrument_id WHERE s.uic IN (?) AND s.environment = ?`, [uics, session.environment],
    );
    for (const r of m) known.set(Number(r.uic), r);
  }
  const positions = rows.map((p) => {
    const b = p.PositionBase;
    const k = known.get(Number(b.Uic));
    const price = k?.price == null ? null : Number(k.price);
    const qty = Number(b.Amount);
    const open = Number(b.OpenPrice);
    return {
      positionId: String(p.PositionId), instrumentId: k ? Number(k.id) : null, symbol: k?.symbol ?? p.DisplayAndFormat?.Symbol ?? String(b.Uic),
      name: k?.name ?? p.DisplayAndFormat?.Description ?? null, currency: p.DisplayAndFormat?.Currency ?? account.currency,
      quantity: qty, openPrice: open, price,
      marketValue: price == null ? null : Number((qty * price).toFixed(2)),
      pnl: price == null ? null : Number((qty * (price - open)).toFixed(2)),
    };
  });
  return {
    environment: session.environment, accountId: account.accountId, currency: account.currency, isTrial: account.isTrial,
    cashBalance: bal?.CashBalance ?? null, totalValue: bal?.TotalValue ?? null, positions,
  };
}

// --- Alertas SAXO ---

export async function alertSettings(pool, userId) {
  const [[r]] = await pool.query('SELECT email_enabled FROM saxo_alert_settings WHERE user_id = ?', [userId]);
  return { emailEnabled: r ? Boolean(r.email_enabled) : true };
}

export async function listNotifications(pool, userId, limit = 50) {
  const [rows] = await pool.query(
    `SELECT n.id, n.order_id, n.kind, n.created_at, n.emailed_at, n.read_at, o.side, o.quantity, o.order_type, o.limit_price, o.saxo_order_id, i.symbol
       FROM saxo_notifications n JOIN saxo_orders o ON o.id = n.order_id JOIN instruments i ON i.id = o.instrument_id
      WHERE n.user_id = ? ORDER BY n.id DESC LIMIT ?`, [userId, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id), orderId: Number(r.order_id), kind: r.kind, symbol: r.symbol, side: r.side, quantity: Number(r.quantity), orderType: r.order_type,
    limitPrice: r.limit_price == null ? null : String(r.limit_price), saxoOrderId: r.saxo_order_id,
    createdAt: r.created_at.toISOString(), emailedAt: r.emailed_at?.toISOString() ?? null, read: Boolean(r.read_at),
  }));
}
