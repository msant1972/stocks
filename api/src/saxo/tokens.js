import { audit, withTransaction } from '../db.js';
import { decryptSecret, encryptSecret } from '../secrets.js';
import * as E from './errors.js';
import { tokenRequest } from './oauth.js';

const PROVIDER = 'saxo';

/** Chave e segredo da aplicação SAXO do utilizador (decifrados), ou null. */
export async function loadApp(conn, cfg, userId) {
  const [[a]] = await conn.query('SELECT app_key, app_secret_enc FROM user_saxo_apps WHERE user_id = ?', [userId]);
  if (!a) return null;
  try { return { key: a.app_key, secret: decryptSecret(cfg.secretKey, a.app_secret_enc) }; } catch { return null; }
}

const inMs = (seconds) => (Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? new Date(Date.now() + Number(seconds) * 1000) : null);

/** Guarda access e refresh tokens (cifrados) de uma ligação OAuth; repõe o token como válido. */
export async function saveOauthTokens(conn, cfg, userId, tok) {
  await conn.query(
    `INSERT INTO user_integration_tokens (user_id, provider, token_enc, environment, auth_kind, refresh_token_enc, expires_at, refresh_expires_at, rejected_at)
     VALUES (?, ?, ?, 'sim', 'oauth', ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE token_enc = VALUES(token_enc), environment = 'sim', auth_kind = 'oauth', refresh_token_enc = VALUES(refresh_token_enc),
       expires_at = VALUES(expires_at), refresh_expires_at = VALUES(refresh_expires_at), rejected_at = NULL`,
    [userId, PROVIDER, encryptSecret(cfg.secretKey, tok.access_token), tok.refresh_token ? encryptSecret(cfg.secretKey, tok.refresh_token) : null,
      inMs(tok.expires_in), inMs(tok.refresh_token_expires_in)],
  );
}

/**
 * Renova o access token de uma ligação OAuth. O refresh token é de uso único (cada renovação invalida o anterior), por isso
 * a linha fica bloqueada (FOR UPDATE) durante o pedido e os dois tokens novos são gravados na mesma transacção: dois pedidos
 * em simultâneo nunca gastam o mesmo refresh token. Devolve true se renovou, false se não era preciso.
 * Se a SAXO recusar o refresh token, a ligação fica marcada como recusada (é preciso voltar a ligar).
 */
export async function refreshUserToken(pool, cfg, userId, { minValidMs = 60_000 } = {}) {
  const outcome = await withTransaction(pool, async (conn) => {
    const [[row]] = await conn.query(
      'SELECT auth_kind, refresh_token_enc, expires_at, refresh_expires_at, rejected_at FROM user_integration_tokens WHERE user_id = ? AND provider = ? FOR UPDATE',
      [userId, PROVIDER],
    );
    if (!row || row.auth_kind !== 'oauth' || row.rejected_at) return 'skip';
    if (row.expires_at && row.expires_at.getTime() > Date.now() + minValidMs) return 'fresh'; // outro pedido já renovou
    const reject = async () => {
      await conn.query('UPDATE user_integration_tokens SET rejected_at = NOW(3), updated_at = updated_at WHERE user_id = ? AND provider = ?', [userId, PROVIDER]);
      await audit(conn, userId, 'saxo.refresh_rejected', 'integration', null, { provider: PROVIDER });
      return 'rejected';
    };
    if (!row.refresh_token_enc || (row.refresh_expires_at && row.refresh_expires_at.getTime() < Date.now())) return reject();
    const app = await loadApp(conn, cfg, userId);
    if (!app) throw E.noToken();
    let refresh;
    try { refresh = decryptSecret(cfg.secretKey, row.refresh_token_enc); } catch { return reject(); }
    let tok;
    try {
      tok = await tokenRequest(cfg, app, { grant_type: 'refresh_token', refresh_token: refresh });
    } catch (err) {
      if (err.code === 'SAXO_OAUTH_REJECTED') return reject();
      throw err; // rede ou 5xx: nada foi gasto, tenta-se mais tarde
    }
    await saveOauthTokens(conn, cfg, userId, tok);
    return 'refreshed';
  });
  if (outcome === 'rejected') throw E.tokenExpired();
  return outcome === 'refreshed';
}

/** Renova de forma antecipada as ligações OAuth que expiram dentro de `aheadMs` (mantém vivo o refresh token). */
export async function refreshDueTokens(pool, cfg, log = null, aheadMs = 5 * 60_000) {
  const [rows] = await pool.query(
    `SELECT user_id FROM user_integration_tokens WHERE provider = ? AND auth_kind = 'oauth' AND rejected_at IS NULL
        AND (expires_at IS NULL OR expires_at < ?)`,
    [PROVIDER, new Date(Date.now() + aheadMs)],
  );
  let n = 0;
  for (const { user_id: userId } of rows) {
    try {
      if (await refreshUserToken(pool, cfg, userId, { minValidMs: aheadMs })) n++;
    } catch (err) {
      log?.warn?.({ userId, code: err.code }, 'saxo: renovação do token falhou');
    }
  }
  return n;
}
