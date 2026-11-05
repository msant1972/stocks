import { createHmac, timingSafeEqual } from 'node:crypto';
import { audit } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { decryptSecret } from '../secrets.js';
import { ageInDays } from '../services/quotes.js';
import { resolveInstrument, saveResolution, storedResolution } from './catalog.js';
import { createSaxoClient, errorText } from './client.js';
import * as E from './errors.js';
import { isOnTick, nearestTick, tickFor } from './ticks.js';
import { refreshUserToken } from './tokens.js';

const PROVIDER = 'saxo';
const CONFIRM_TTL_MS = 5 * 60_000;

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
  // token: só para o streaming (o WebSocket autentica-se no endereço); nunca sai do servidor.
  return { client, environment, userId, token };
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

async function loadInstrument(pool, instrumentId) {
  const [[inst]] = await pool.query(
    'SELECT id, symbol, name, exchange, currency, status, isin, mic FROM instruments WHERE id = ?', [instrumentId],
  );
  if (!inst) throw notFound('Instrumento');
  if (inst.status !== 'active') throw new AppError(409, 'INSTRUMENT_NOT_ACTIVE', 'o instrumento ainda não está activo ou é inválido');
  return inst;
}

/** Escolha manual de um candidato (revalidado nos detalhes da SAXO). Substitui a correspondência que houver. */
export async function chooseInstrument(pool, session, instrumentId, uic) {
  const inst = await loadInstrument(pool, instrumentId);
  const account = await pickAccount(session.client, inst.currency);
  const d = await session.client.get(`/ref/v1/instruments/details/${Number(uic)}/Stock`, { AccountKey: account.accountKey });
  if (!d?.Uic) throw new AppError(422, 'SAXO_INSTRUMENT_NOT_FOUND', 'instrumento não encontrado na SAXO Bank');
  const cand = { uic: Number(d.Uic), symbol: d.Symbol, description: d.Description, exchangeId: d.Exchange?.ExchangeId ?? null, currency: d.CurrencyCode };
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

function parseScheme(saxo) {
  try { return saxo.tick_scheme ? JSON.parse(saxo.tick_scheme) : null; } catch { return null; } // ilegível: a SAXO valida
}

/** Erro 422 SAXO_TICK_SIZE quando o preço não respeita o passo de preço, com o valor válido mais próximo. */
function checkTick(scheme, price, label = 'o preço limite', field = 'limit') {
  if (!scheme || isOnTick(scheme, price)) return;
  const tick = tickFor(scheme, price);
  const suggested = nearestTick(scheme, price);
  throw new AppError(422, 'SAXO_TICK_SIZE', `${label} não respeita o passo de preço da bolsa (${tick}); o valor válido mais próximo é ${suggested}`, { tickSize: tick, suggested, field });
}

/** Distância de um stop móvel: múltiplo do passo de preço ao preço de referência. */
function checkDistance(scheme, distance, refPrice) {
  const tick = scheme ? tickFor(scheme, refPrice) : null;
  if (!tick) return;
  const S = 1e6;
  const t = Math.round(tick * S);
  const d = Math.round(Number(distance) * S);
  if (d % t !== 0) {
    const suggested = String(Number((Math.max(t, Math.round(d / t) * t) / S).toFixed(6)));
    throw new AppError(422, 'SAXO_TICK_SIZE', `a distância do stop móvel tem de ser múltipla do passo de preço (${tick}); o valor válido mais próximo é ${suggested}`, { tickSize: tick, suggested, field: 'distance' });
  }
}

const SAXO_TYPE = { limit: 'Limit', market: 'Market', stop: 'StopIfTraded', trailing: 'TrailingStopIfTraded' };

/** Preço de referência da ordem: o limite, ou o último preço da aplicação nas ordens a mercado. */
const refPriceOf = (p, quote) => Number(p.orderType === 'limit' ? p.limitPrice : quote.price);

function confirmationMac(cfg, parts) {
  const key = createHmac('sha256', cfg.secretKey).update('saxo-order-confirm').digest();
  return createHmac('sha256', key).update(JSON.stringify(parts)).digest('base64url');
}

function signParams(cfg, userId, p, uic, environment, exp) {
  const stop = p.stop ? [p.stop.type, canonPrice(p.stop.price), canonPrice(p.stop.distance)] : null;
  return confirmationMac(cfg, [userId, p.instrumentId, uic, environment, p.side, p.quantity, p.orderType, canonPrice(p.limitPrice), stop, exp]);
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

/** Ordem de stop associada à compra (activa-se quando a compra é executada; válida até ser cancelada). */
function stopLeg(accountKey, saxo, p, refPrice) {
  const scheme = parseScheme(saxo);
  const leg = {
    AccountKey: accountKey, Uic: Number(saxo.uic), AssetType: saxo.asset_type, BuySell: 'Sell', Amount: p.quantity,
    OrderType: SAXO_TYPE[p.stop.type], OrderDuration: { DurationType: 'GoodTillCancel' }, ManualOrder: true,
  };
  if (p.stop.type === 'stop') {
    leg.OrderPrice = Number(p.stop.price);
  } else {
    const distance = Number(p.stop.distance);
    const start = refPrice - distance;
    leg.OrderPrice = Number(scheme ? nearestTick(scheme, start) : start.toFixed(4));
    leg.TrailingStopDistanceToMarket = distance;
    leg.TrailingStopStep = (scheme && tickFor(scheme, refPrice)) || 0.01;
  }
  return leg;
}

function orderBody(accountKey, saxo, p, refPrice) {
  const body = {
    AccountKey: accountKey, Uic: Number(saxo.uic), AssetType: saxo.asset_type, BuySell: p.side === 'buy' ? 'Buy' : 'Sell',
    Amount: p.quantity, OrderType: SAXO_TYPE[p.orderType], OrderDuration: { DurationType: 'DayOrder' }, ManualOrder: true,
  };
  if (p.orderType === 'limit') body.OrderPrice = Number(p.limitPrice);
  if (p.stop) body.Orders = [stopLeg(accountKey, saxo, p, refPrice)];
  return body;
}

function checkParams(saxo, p, refPrice) {
  const types = (saxo.order_types ?? '').split(',').filter(Boolean);
  const needs = [SAXO_TYPE[p.orderType], ...(p.stop ? [SAXO_TYPE[p.stop.type]] : [])];
  for (const t of needs) {
    if (types.length && !types.includes(t)) throw new AppError(409, 'SAXO_ORDER_TYPE', `este instrumento não aceita ordens do tipo ${t}`);
  }
  const scheme = parseScheme(saxo);
  if (p.orderType === 'limit') checkTick(scheme, p.limitPrice);
  if (p.stop) {
    if (p.side !== 'buy') throw new AppError(422, 'SAXO_STOP_ONLY_BUY', 'o stop associado só existe nas compras');
    if (p.stop.type === 'stop') {
      if (!(Number(p.stop.price) > 0)) throw new AppError(422, 'STOP_PRICE_REQUIRED', 'indique o preço do stop');
      if (Number(p.stop.price) >= refPrice) throw new AppError(422, 'SAXO_STOP_ABOVE', 'o preço do stop tem de ser inferior ao preço de compra');
      checkTick(scheme, p.stop.price, 'o preço do stop', 'stop');
    } else {
      if (!(Number(p.stop.distance) > 0)) throw new AppError(422, 'STOP_DISTANCE_REQUIRED', 'indique a distância do stop móvel');
      if (Number(p.stop.distance) >= refPrice) throw new AppError(422, 'SAXO_STOP_ABOVE', 'a distância do stop móvel tem de ser inferior ao preço de compra');
      checkDistance(scheme, p.stop.distance, refPrice);
    }
  }
  if (saxo.min_size != null && p.quantity < Number(saxo.min_size)) {
    throw new AppError(422, 'SAXO_MIN_SIZE', `a quantidade mínima é ${Number(saxo.min_size)}`);
  }
}

/**
 * Pré-validação: resolve o instrumento, corre o precheck da SAXO (com o stop associado, se houver) e devolve o resumo com um
 * código de confirmação (assinado, 5 minutos) ligado aos parâmetros exactos. Nada é enviado.
 */
export async function previewOrder(pool, cfg, session, p, { wait }) {
  if (p.orderType === 'limit' && !(Number(p.limitPrice) > 0)) throw new AppError(422, 'LIMIT_PRICE_REQUIRED', 'indique o preço limite');
  const inst = await loadInstrument(pool, p.instrumentId);
  const quote = await appQuote(pool, inst.id, cfg.maxQuoteAgeDays);
  const account = await pickAccount(session.client, inst.currency);
  let saxo = await resolveInstrument(pool, session, inst, account.accountKey);
  if (!saxo.tradable) throw new AppError(409, 'SAXO_NOT_TRADABLE', `${saxo.saxo_symbol} não está negociável na SAXO Bank (ver Correspondência SAXO)`);
  if (!saxo.tick_scheme) { // correspondência guardada antes de se registar o passo de preço
    saxo = await saveResolution(pool, session, inst, { uic: Number(saxo.uic), symbol: saxo.saxo_symbol, exchangeId: saxo.exchange_id, description: saxo.description, currency: saxo.currency }, account.accountKey, saxo.source);
  }
  const refPrice = refPriceOf(p, quote);
  checkParams(saxo, p, refPrice);

  await wait(session.userId);
  const body = orderBody(account.accountKey, saxo, p, refPrice);
  const pre = await session.client.post('/trade/v2/orders/precheck', body);
  const result = pre?.PreCheckResult ?? 'Unknown';
  const ok = result === 'Ok';
  const exp = Date.now() + CONFIRM_TTL_MS;
  const leg = body.Orders?.[0];
  return {
    environment: session.environment, ok,
    problem: ok ? null : (errorText(pre) ?? `a SAXO Bank não aceitou a ordem (${result})`),
    instrument: { id: inst.id, symbol: inst.symbol, name: inst.name, saxoSymbol: saxo.saxo_symbol, exchangeId: saxo.exchange_id, uic: Number(saxo.uic) },
    account: { id: account.accountId, currency: account.currency, isTrial: account.isTrial },
    side: p.side, quantity: p.quantity, orderType: p.orderType, limitPrice: p.orderType === 'limit' ? canonPrice(p.limitPrice) : null,
    stop: leg ? { type: p.stop.type, price: String(leg.OrderPrice), distance: leg.TrailingStopDistanceToMarket == null ? null : String(leg.TrailingStopDistanceToMarket) } : null,
    appPrice: quote.price, appPriceDate: quote.date, currency: inst.currency,
    estimatedAmount: (p.quantity * refPrice).toFixed(2),
    confirmation: ok ? `${exp}.${signParams(cfg, session.userId, p, Number(saxo.uic), session.environment, exp)}` : null,
    expiresAt: new Date(exp).toISOString(),
  };
}

const dec = (v) => (v == null ? null : String(v));
const mapOrder = (r) => ({
  id: Number(r.id), parentId: r.parent_id == null ? null : Number(r.parent_id), instrumentId: Number(r.instrument_id),
  symbol: r.symbol ?? null, name: r.name ?? null, environment: r.environment,
  saxoOrderId: r.saxo_order_id, side: r.side, quantity: Number(r.quantity), orderType: r.order_type,
  limitPrice: dec(r.limit_price), stopPrice: dec(r.stop_price), trailDistance: dec(r.trail_distance), appPrice: dec(r.app_price),
  filledQuantity: r.filled_quantity == null ? null : Number(r.filled_quantity), fillPrice: dec(r.fill_price),
  finishedAt: r.finished_at?.toISOString() ?? null,
  status: r.status, message: r.message, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});

const ORDER_SELECT = `SELECT o.*, i.symbol, i.name FROM saxo_orders o JOIN instruments i ON i.id = o.instrument_id`;

async function orderById(pool, userId, id) {
  const [[r]] = await pool.query(`${ORDER_SELECT} WHERE o.id = ? AND o.user_id = ?`, [id, userId]);
  return r ? mapOrder(r) : null;
}

/** Envia a ordem (e o stop associado, se houver) depois de verificar o código. Repetir a idempotencyKey devolve a original. */
export async function placeOrder(pool, cfg, session, p, { wait }) {
  const userId = session.userId;
  const [[prev]] = await pool.query('SELECT id FROM saxo_orders WHERE user_id = ? AND idempotency_key = ?', [userId, p.idempotencyKey]);
  if (prev) return { order: await orderById(pool, userId, prev.id), replayed: true };

  const inst = await loadInstrument(pool, p.instrumentId);
  const saxo = await storedResolution(pool, inst.id, session.environment);
  if (!saxo) throw new AppError(409, 'SAXO_BAD_CONFIRMATION', 'pré-valide a ordem antes de a enviar');
  checkConfirmation(cfg, userId, p, Number(saxo.uic), session.environment, p.confirmation);
  const quote = await appQuote(pool, inst.id, cfg.maxQuoteAgeDays);
  const refPrice = refPriceOf(p, quote);
  checkParams(saxo, p, refPrice);
  const account = await pickAccount(session.client, inst.currency);
  const body = orderBody(account.accountKey, saxo, p, refPrice);

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
    const res = await session.client.post('/trade/v2/orders', body, p.idempotencyKey);
    if (!res?.OrderId) throw E.unavailable('a SAXO Bank não devolveu o número da ordem');
    await finish('working', null, String(res.OrderId));
    if (body.Orders) {
      const leg = body.Orders[0];
      const legId = res.Orders?.[0]?.OrderId;
      await pool.query(
        `INSERT INTO saxo_orders (user_id, parent_id, instrument_id, environment, idempotency_key, saxo_order_id, side, quantity, order_type, stop_price, trail_distance, app_price, status, message)
         VALUES (?, ?, ?, ?, ?, ?, 'sell', ?, ?, ?, ?, ?, ?, ?)`,
        [userId, id, inst.id, session.environment, `${p.idempotencyKey.slice(0, 58)}-stop`, legId ? String(legId) : null, p.quantity,
          p.stop.type === 'stop' ? 'stop' : 'trailing_stop', leg.OrderPrice, leg.TrailingStopDistanceToMarket ?? null, quote.price,
          legId ? 'working' : 'unknown', legId ? 'activa-se quando a compra for executada' : 'a SAXO não devolveu o número do stop: confirme na SAXO'],
      );
    }
    await audit(pool, userId, 'saxo.order_placed', 'saxo_order', id, {
      environment: session.environment, instrumentId: inst.id, side: p.side, quantity: p.quantity, orderType: p.orderType,
      stop: p.stop?.type ?? null, saxoOrderId: String(res.OrderId),
    });
  } catch (err) {
    const definitive = err.status === 422 || err.status === 403 || err.status === 409 || err.code === 'SAXO_TOKEN_EXPIRED';
    await finish(definitive ? 'rejected' : 'unknown', definitive ? err.message : 'sem resposta da SAXO Bank: confirme na SAXO se a ordem foi aceite');
    await audit(pool, userId, 'saxo.order_failed', 'saxo_order', id, { code: err.code ?? 'ERROR', status: definitive ? 'rejected' : 'unknown' });
    throw err;
  }
  return { order: await orderById(pool, userId, id), replayed: false };
}

// --- Estado final das ordens (histórico da SAXO) ---

const FINAL = { FinalFill: 'filled', Cancelled: 'cancelled', Expired: 'expired', Rejected: 'rejected' };

async function clientKey(session) {
  if (!session.clientKey) session.clientKey = (await session.client.get('/port/v1/users/me'))?.ClientKey;
  return session.clientKey;
}

/** Estado final de uma ordem no histórico da SAXO (executada, cancelada, expirada, recusada), ou null se ainda não terminou. */
export async function orderOutcome(session, saxoOrderId) {
  const res = await session.client.get('/cs/v1/audit/orderactivities', { ClientKey: await clientKey(session), OrderId: saxoOrderId });
  const final = [...(res?.Data ?? [])].reverse().find((a) => FINAL[a.Status] && String(a.OrderId) === String(saxoOrderId));
  if (!final) return null;
  return {
    status: FINAL[final.Status],
    filledQuantity: final.FilledAmount ?? null,
    fillPrice: final.AveragePrice ?? final.ExecutionPrice ?? null,
    at: final.ActivityTime ? new Date(final.ActivityTime) : new Date(),
  };
}

const NOTIFY = new Set(['filled', 'expired', 'cancelled']);

/** Grava o estado final (uma só vez, mesmo com consultas em simultâneo) e o aviso. Devolve 1 se gerou aviso. */
async function finishOrder(pool, userId, id, o, { notify = true } = {}) {
  const [res] = await pool.query(
    `UPDATE saxo_orders SET status = ?, filled_quantity = ?, fill_price = ?, finished_at = ?, message = NULL
      WHERE id = ? AND (status = 'working' OR (status = 'ended' AND finished_at IS NULL))`,
    [o.status, o.filledQuantity, o.fillPrice, o.at, id],
  );
  if (!res.affectedRows || !notify || !NOTIFY.has(o.status)) return 0;
  await pool.query('INSERT IGNORE INTO saxo_notifications (user_id, order_id, kind) VALUES (?, ?, ?)', [userId, id, o.status]);
  return 1;
}

/** Sem histórico disponível: passa a «ended» (já não está aberta) e avisa. */
async function markEnded(pool, userId, id) {
  const [res] = await pool.query(
    "UPDATE saxo_orders SET status = 'ended', message = 'já não está aberta na SAXO (executada, expirada ou cancelada)' WHERE id = ? AND status = 'working'", [id],
  );
  if (!res.affectedRows) return 0;
  await pool.query("INSERT IGNORE INTO saxo_notifications (user_id, order_id, kind) VALUES (?, ?, 'ended')", [userId, id]);
  return 1;
}

const STALE_WORKING_MS = 3 * 86_400_000; // sem estado final ao fim de 3 dias: deixa de se esperar

/**
 * Ordens do utilizador. As abertas são confrontadas com as ordens abertas da SAXO (incluindo as associadas, em
 * RelatedOpenOrders); as que desapareceram ficam com o estado final do histórico da SAXO e geram aviso.
 * `ended` conta os avisos gerados nesta consulta.
 */
export async function listOrders(pool, session, { limit = 50, offset = 0 } = {}) {
  const userId = session.userId;
  // Um envio que ficou a meio (a API reiniciou) não pode ficar «a enviar» para sempre: passa a «por confirmar».
  await pool.query(
    "UPDATE saxo_orders SET status = 'unknown', message = 'envio interrompido: confirme na SAXO se a ordem foi aceite' WHERE user_id = ? AND status = 'sending' AND created_at < NOW(3) - INTERVAL 2 MINUTE",
    [userId],
  );
  let refreshError = null;
  let ended = 0;
  const [open] = await pool.query("SELECT id, saxo_order_id, created_at FROM saxo_orders WHERE user_id = ? AND status = 'working' AND saxo_order_id IS NOT NULL", [userId]);
  if (open.length && session.client) {
    try {
      const res = await session.client.get('/port/v1/orders/me');
      const live = new Set();
      for (const o of res?.Data ?? []) {
        live.add(String(o.OrderId));
        for (const r of o.RelatedOpenOrders ?? []) live.add(String(r.OrderId));
      }
      for (const o of open.filter((x) => !live.has(String(x.saxo_order_id)))) {
        let outcome = null;
        try {
          outcome = await orderOutcome(session, o.saxo_order_id);
        } catch (err) {
          if (err.code === 'SAXO_TOKEN_EXPIRED') throw err;
          ended += await markEnded(pool, userId, o.id); // sem histórico: comportamento anterior
          continue;
        }
        if (outcome) ended += await finishOrder(pool, userId, o.id, outcome);
        else if (Date.now() - o.created_at.getTime() > STALE_WORKING_MS) ended += await markEnded(pool, userId, o.id);
      }
      // Ordens antigas só marcadas «já não está aberta»: completa-se o estado real, sem novo aviso (no máximo 5 por consulta).
      const [legacy] = await pool.query("SELECT id, saxo_order_id FROM saxo_orders WHERE user_id = ? AND status = 'ended' AND finished_at IS NULL AND saxo_order_id IS NOT NULL ORDER BY id DESC LIMIT 5", [userId]);
      for (const o of legacy) {
        const outcome = await orderOutcome(session, o.saxo_order_id).catch(() => null);
        if (outcome) await finishOrder(pool, userId, o.id, outcome, { notify: false });
      }
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
  await pool.query("UPDATE saxo_orders SET status = 'cancelled', message = NULL, finished_at = NOW(3) WHERE id = ?", [id]);
  // Cancelar a compra cancela também o stop associado (na SAXO, as ordens associadas caem com a principal).
  await pool.query("UPDATE saxo_orders SET status = 'cancelled', message = 'cancelado com a compra', finished_at = NOW(3) WHERE parent_id = ? AND status IN ('working','unknown')", [id]);
  await audit(pool, session.userId, 'saxo.order_cancelled', 'saxo_order', id, { saxoOrderId: order.saxoOrderId });
  return orderById(pool, session.userId, id);
}

/**
 * Alterar uma ordem aberta: quantidade e/ou preço limite de uma ordem limitada, ou o preço de um stop fixo.
 * Os stops móveis e as ordens a mercado não se alteram (cancele e envie de novo).
 */
export async function modifyOrder(pool, session, id, change, { wait }) {
  const userId = session.userId;
  const [[r]] = await pool.query('SELECT * FROM saxo_orders WHERE id = ? AND user_id = ?', [id, userId]);
  if (!r) throw notFound('Ordem');
  if (r.status !== 'working' || !r.saxo_order_id) throw new AppError(409, 'SAXO_NOT_MODIFIABLE', 'só se podem alterar ordens abertas');
  if (!['limit', 'stop'].includes(r.order_type)) throw new AppError(409, 'SAXO_NOT_MODIFIABLE', 'só se alteram ordens limitadas e stops fixos; cancele e envie de novo');
  if (r.order_type === 'stop' && change.quantity != null && change.quantity !== Number(r.quantity)) {
    throw new AppError(422, 'SAXO_STOP_QUANTITY', 'a quantidade do stop acompanha a da compra');
  }
  const quantity = change.quantity ?? Number(r.quantity);
  const price = change.price ?? String(r.order_type === 'limit' ? r.limit_price : r.stop_price);
  const saxo = await storedResolution(pool, r.instrument_id, r.environment);
  if (!saxo) throw notFound('Instrumento SAXO');
  checkTick(parseScheme(saxo), price, r.order_type === 'stop' ? 'o preço do stop' : 'o preço limite', 'price');
  if (saxo.min_size != null && quantity < Number(saxo.min_size)) throw new AppError(422, 'SAXO_MIN_SIZE', `a quantidade mínima é ${Number(saxo.min_size)}`);
  const account = await pickAccount(session.client);
  await wait(userId);
  await session.client.patch('/trade/v2/orders', {
    AccountKey: account.accountKey, OrderId: r.saxo_order_id, AssetType: saxo.asset_type, Amount: quantity,
    OrderType: r.order_type === 'limit' ? 'Limit' : 'StopIfTraded', OrderPrice: Number(price),
    OrderDuration: { DurationType: r.order_type === 'limit' ? 'DayOrder' : 'GoodTillCancel' },
  });
  await pool.query(
    `UPDATE saxo_orders SET quantity = ?, ${r.order_type === 'limit' ? 'limit_price' : 'stop_price'} = ? WHERE id = ?`, [quantity, price, id],
  );
  await audit(pool, userId, 'saxo.order_modified', 'saxo_order', id, { saxoOrderId: r.saxo_order_id, quantity, price });
  return orderById(pool, userId, id);
}

/** Linha do instrumento da aplicação a partir do Uic da SAXO (para ligar posições às páginas da aplicação). */
async function knownByUic(pool, uics, environment) {
  const known = new Map();
  if (!uics.length) return known;
  const [m] = await pool.query(
    `SELECT s.uic, i.id, i.symbol, i.name, (SELECT q.close FROM daily_quotes q WHERE q.instrument_id = i.id ORDER BY q.session_date DESC LIMIT 1) AS price
       FROM saxo_instruments s JOIN instruments i ON i.id = s.instrument_id WHERE s.uic IN (?) AND s.environment = ?`, [uics, environment],
  );
  for (const r of m) known.set(Number(r.uic), r);
  return known;
}

/**
 * Carteira da conta SAXO: saldo, posições abertas e posições fechadas com o resultado realizado. O SIM não tem preços, por isso
 * o valor das abertas usa o último preço da aplicação.
 */
export async function getPortfolio(pool, session) {
  const account = await pickAccount(session.client);
  const bal = await session.client.get('/port/v1/balances/me');
  const pos = await session.client.get('/port/v1/positions/me', { FieldGroups: 'PositionBase,PositionView,DisplayAndFormat' });
  let closedRaw = [];
  try {
    const c = await session.client.get('/port/v1/closedpositions/me', { FieldGroups: 'ClosedPosition,DisplayAndFormat' });
    closedRaw = Array.isArray(c) ? c : (c?.Data ?? []);
  } catch (err) {
    if (err.code === 'SAXO_TOKEN_EXPIRED') throw err;
  }
  const rows = (pos?.Data ?? []).filter((p) => p.PositionBase?.Status !== 'Closed' && p.PositionBase?.AssetType === 'Stock');
  const closedRows = closedRaw.filter((c) => (c.ClosedPosition?.AssetType ?? 'Stock') === 'Stock');
  const known = await knownByUic(pool, [...new Set([...rows.map((p) => Number(p.PositionBase.Uic)), ...closedRows.map((c) => Number(c.ClosedPosition?.Uic))].filter(Boolean))], session.environment);
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
  const closed = closedRows.map((c) => {
    const cp = c.ClosedPosition ?? {};
    const k = known.get(Number(cp.Uic));
    return {
      closedPositionId: String(c.ClosedPositionUniqueId ?? cp.ClosingPositionId ?? `${cp.Uic}-${cp.ExecutionTimeClose}`),
      instrumentId: k ? Number(k.id) : null, symbol: k?.symbol ?? c.DisplayAndFormat?.Symbol ?? String(cp.Uic),
      name: k?.name ?? c.DisplayAndFormat?.Description ?? null, currency: c.DisplayAndFormat?.Currency ?? account.currency,
      quantity: Math.abs(Number(cp.Amount ?? 0)), openPrice: cp.OpenPrice ?? null, closePrice: cp.ClosingPrice ?? null,
      pnl: cp.ProfitLossOnTrade ?? null, openedAt: cp.ExecutionTimeOpen ?? null, closedAt: cp.ExecutionTimeClose ?? null,
    };
  });
  return {
    environment: session.environment, accountId: account.accountId, currency: account.currency, isTrial: account.isTrial,
    cashBalance: bal?.CashBalance ?? null, totalValue: bal?.TotalValue ?? null, positions, closed,
  };
}

// --- Alertas SAXO ---

export async function alertSettings(pool, userId) {
  const [[r]] = await pool.query('SELECT email_enabled FROM saxo_alert_settings WHERE user_id = ?', [userId]);
  return { emailEnabled: r ? Boolean(r.email_enabled) : true };
}

export async function listNotifications(pool, userId, limit = 50) {
  const [rows] = await pool.query(
    `SELECT n.id, n.order_id, n.kind, n.created_at, n.emailed_at, n.read_at, o.side, o.quantity, o.order_type, o.limit_price, o.stop_price, o.saxo_order_id, o.filled_quantity, o.fill_price, i.symbol
       FROM saxo_notifications n JOIN saxo_orders o ON o.id = n.order_id JOIN instruments i ON i.id = o.instrument_id
      WHERE n.user_id = ? ORDER BY n.id DESC LIMIT ?`, [userId, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id), orderId: Number(r.order_id), kind: r.kind, symbol: r.symbol, side: r.side, quantity: Number(r.quantity), orderType: r.order_type,
    limitPrice: dec(r.limit_price), stopPrice: dec(r.stop_price), saxoOrderId: r.saxo_order_id,
    filledQuantity: r.filled_quantity == null ? null : Number(r.filled_quantity), fillPrice: dec(r.fill_price),
    createdAt: r.created_at.toISOString(), emailedAt: r.emailed_at?.toISOString() ?? null, read: Boolean(r.read_at),
  }));
}
