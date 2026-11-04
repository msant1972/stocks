import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';
import * as E from './errors.js';

const STATE_TTL_MS = 10 * 60_000;

/** URL de retorno registado na aplicação SAXO (tem de coincidir exactamente). */
export const redirectUri = (cfg) => (cfg.publicOrigin ? `${cfg.publicOrigin.replace(/\/$/, '')}/api/v1/integrations/saxo/callback` : null);

const stateKey = (cfg) => createHmac('sha256', cfg.secretKey).update('saxo-oauth-state').digest();
const mac = (cfg, parts) => createHmac('sha256', stateKey(cfg)).update(JSON.stringify(parts)).digest('base64url');

/** `state` assinado e de curta duração, ligado ao utilizador que iniciou a ligação (o callback chega sem cookie de sessão). */
export function signState(cfg, userId, now = Date.now()) {
  const exp = now + STATE_TTL_MS;
  const nonce = randomBytes(12).toString('base64url');
  return `${userId}.${exp}.${nonce}.${mac(cfg, [userId, exp, nonce])}`;
}

/** Devolve o id do utilizador, ou null se o state for inválido ou tiver expirado. */
export function verifyState(cfg, state, now = Date.now()) {
  const [id, expText, nonce, tag] = String(state ?? '').split('.');
  const userId = Number(id);
  const exp = Number(expText);
  if (!Number.isInteger(userId) || userId < 1 || !Number.isFinite(exp) || !nonce || !tag || exp < now) return null;
  const want = Buffer.from(mac(cfg, [userId, exp, nonce]));
  const got = Buffer.from(tag);
  return want.length === got.length && timingSafeEqual(want, got) ? userId : null;
}

export function authorizeUrl(cfg, appKey, state) {
  const u = new URL('/authorize', cfg.saxo.authUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', appKey);
  u.searchParams.set('state', state);
  u.searchParams.set('redirect_uri', redirectUri(cfg));
  return u.toString();
}

/**
 * Pedido ao endpoint /token (autorização HTTP Basic com chave:segredo da aplicação). Devolve o JSON com
 * access_token, expires_in, refresh_token, refresh_token_expires_in. 400/401 → SAXO_OAUTH_REJECTED (código ou refresh token
 * inválido); rede ou 5xx → 502. A resposta de erro nunca inclui o segredo.
 */
export async function tokenRequest(cfg, app, form) {
  const doFetch = cfg.saxo.fetchImpl ?? fetch;
  let res;
  try {
    res = await doFetch(new URL('/token', cfg.saxo.authUrl), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${app.key}:${app.secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(cfg.saxo.timeoutMs),
    });
  } catch {
    throw E.unavailable('falha de rede na ligação ao servidor de autorização da SAXO Bank');
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* corpo não JSON */ }
  if (res.ok && json?.access_token) return json;
  if (res.status >= 500) throw E.unavailable(`o servidor de autorização da SAXO Bank respondeu com o erro ${res.status}`);
  const why = [json?.error, json?.error_description].filter((x) => typeof x === 'string').join(': ').slice(0, 200);
  throw new AppError(422, 'SAXO_OAUTH_REJECTED', `a SAXO Bank recusou a autorização${why ? ` (${why})` : ''}`);
}
