import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'stocks_session';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export async function createSession(pool, userId, days) {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, NOW(3) + INTERVAL ? DAY)',
    [hashToken(token), userId, days],
  );
  return token;
}

/**
 * Devolve o utilizador da sessão, ou null. A validade é renovada quando já passou metade do prazo,
 * para que uma sessão em uso não expire, sem escrever na BD a cada pedido.
 */
export async function resolveSession(pool, token, days) {
  if (!token) return null;
  const hash = hashToken(token);
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.name, u.is_admin,
            s.expires_at < NOW(3) + INTERVAL ? HOUR AS needs_renewal
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
  return { id: Number(row.id), email: row.email, name: row.name, isAdmin: Boolean(row.is_admin), renewed: Boolean(row.needs_renewal) };
}

export async function destroySession(pool, token) {
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
}

export async function destroyUserSessions(conn, userId) {
  await conn.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
}
