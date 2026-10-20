import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'stocks_session';

/** Validade das sessões restritas (palavra-passe certa, segundo factor por fazer). */
export const RESTRICTED_MINUTES = 15;
/** Códigos errados tolerados numa sessão restrita antes de a terminar. */
export const MAX_MFA_FAILURES = 5;

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/**
 * Cria uma sessão. stage 'full' dá acesso à aplicação; 'mfa_verify' e 'mfa_setup' só às rotas do
 * segundo factor, e expiram em RESTRICTED_MINUTES sem renovação.
 */
export async function createSession(pool, userId, days, stage = 'full') {
  const token = randomBytes(32).toString('base64url');
  const expiry = stage === 'full' ? 'NOW(3) + INTERVAL ? DAY' : 'NOW(3) + INTERVAL ? MINUTE';
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, stage, expires_at) VALUES (?, ?, ?, ${expiry})`,
    [hashToken(token), userId, stage, stage === 'full' ? days : RESTRICTED_MINUTES],
  );
  return token;
}

/**
 * Devolve o utilizador da sessão, ou null. A validade das sessões completas é renovada quando já
 * passou metade do prazo, para que uma sessão em uso não expire, sem escrever na BD a cada pedido.
 */
export async function resolveSession(pool, token, days) {
  if (!token) return null;
  const hash = hashToken(token);
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.name, u.is_admin, u.totp_enabled_at, s.stage,
            s.stage = 'full' AND s.expires_at < NOW(3) + INTERVAL ? HOUR AS needs_renewal
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > NOW(3) AND u.disabled_at IS NULL`,
    [days * 12, hash],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.needs_renewal) {
    await pool.query(
      'UPDATE sessions SET expires_at = NOW(3) + INTERVAL ? DAY, last_seen_at = NOW(3) WHERE token_hash = ?',
      [days, hash],
    );
  }
  return {
    id: Number(row.id), email: row.email, name: row.name, isAdmin: Boolean(row.is_admin),
    mfaEnabled: row.totp_enabled_at != null, stage: row.stage, renewed: Boolean(row.needs_renewal),
  };
}

/**
 * Conta um código errado na sessão. Devolve true quando se atingiu o limite e a sessão foi terminada.
 */
export async function recordMfaFailure(pool, token) {
  const hash = hashToken(token);
  await pool.query('UPDATE sessions SET mfa_failures = mfa_failures + 1 WHERE token_hash = ?', [hash]);
  const [[s]] = await pool.query('SELECT mfa_failures FROM sessions WHERE token_hash = ?', [hash]);
  if (!s || s.mfa_failures >= MAX_MFA_FAILURES) {
    await pool.query('DELETE FROM sessions WHERE token_hash = ?', [hash]);
    return true;
  }
  return false;
}

export async function destroySession(pool, token) {
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
}

export async function destroyUserSessions(conn, userId) {
  await conn.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
}
