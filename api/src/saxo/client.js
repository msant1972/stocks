import * as E from './errors.js';

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
const ORDER_PATH = /^\/trade\/v2\/orders/;

/** Segundos até o limite repor (cabeçalho x-ratelimit-<grupo>-reset), ou null. */
function resetSeconds(headers) {
  for (const [k, v] of headers?.entries?.() ?? []) {
    if (/^x-ratelimit-.*-reset$/i.test(k) && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** Texto de erro devolvido pela SAXO (sem nunca ecoar o token). */
export function errorText(body) {
  if (!body || typeof body !== 'object') return null;
  const m = body.ErrorInfo?.Message ?? body.Message ?? body.ErrorInfo?.ErrorCode ?? body.ErrorCode ?? null;
  return typeof m === 'string' ? m.slice(0, 300) : null;
}

/**
 * Cliente mínimo da OpenAPI da SAXO. O token fica só neste objecto, em memória, durante o pedido.
 * Erros: 401 → SAXO_TOKEN_EXPIRED (e onUnauthorized), 403, 409 (duplicado), 429 (espera ≤ 1,5 s e repete uma vez),
 * 5xx/rede → 502, restantes 4xx → 422 com a mensagem da SAXO.
 */
export function createSaxoClient({ baseUrl, token, fetchImpl = null, timeoutMs = 10_000, sleep = sleepReal, onUnauthorized = null }) {
  const doFetch = fetchImpl ?? fetch;
  const root = baseUrl.replace(/\/$/, '');

  async function request(method, path, { query, body, requestId, retried = false } = {}) {
    const url = new URL(root + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v != null) url.searchParams.set(k, String(v));
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (requestId) headers['x-request-id'] = requestId;
    let res;
    try {
      res = await doFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw E.unavailable(err?.name === 'TimeoutError' ? 'a SAXO Bank demorou demasiado a responder' : 'falha de rede na ligação à SAXO Bank');
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* corpo não JSON */ }

    if (res.status >= 200 && res.status < 300) return json;
    if (res.status === 401) {
      await onUnauthorized?.();
      throw E.tokenExpired();
    }
    if (res.status === 403) throw E.forbidden(errorText(json));
    if (res.status === 429) {
      if (!retried) {
        const reset = resetSeconds(res.headers);
        await sleep(Math.min(1500, Math.max(300, (reset ?? 1) * 1000)));
        return request(method, path, { query, body, requestId, retried: true });
      }
      throw E.rateLimited();
    }
    if (res.status === 409 && ORDER_PATH.test(path)) throw E.duplicate();
    if (res.status >= 500) throw E.unavailable(`a SAXO Bank respondeu com o erro ${res.status}`);
    throw E.rejected(errorText(json));
  }

  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body, requestId) => request('POST', path, { body, requestId }),
    del: (path, query) => request('DELETE', path, { query }),
  };
}

/** Espaça os pedidos de ordens de cada utilizador (1 por segundo, limite da SAXO). minMs: número ou função. */
export function createThrottle(minMs, { now = Date.now, sleep = sleepReal } = {}) {
  const tails = new Map();
  const last = new Map();
  return async function wait(key) {
    const prev = tails.get(key) ?? Promise.resolve();
    const mine = prev.then(async () => {
      const gap = (last.get(key) ?? 0) + (typeof minMs === 'function' ? minMs() : minMs) - now();
      if (gap > 0) await sleep(gap);
      last.set(key, now());
    });
    tails.set(key, mine.catch(() => {}));
    return mine;
  };
}
