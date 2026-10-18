import { audit, withTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { cents, fromCents } from '../money.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/password.js';
import { destroyUserSessions } from '../auth/sessions.js';

export function normaliseEmail(email) {
  return String(email).trim().toLowerCase();
}

export function passwordError(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `a palavra-passe deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`;
  }
  if (password.length > 200) return 'a palavra-passe é demasiado longa';
  return null;
}

/** Cria o utilizador e a respectiva carteira virtual com o capital inicial. */
export async function createUser(pool, { email, name, password, isAdmin = false, initialCapital }, hashParams) {
  const err = passwordError(password);
  if (err) throw new AppError(400, 'WEAK_PASSWORD', err);
  const capital = cents(initialCapital);
  if (capital <= 0n) throw new AppError(400, 'INVALID_CAPITAL', 'o capital inicial deve ser positivo');
  const hash = await hashPassword(password, hashParams);
  return withTransaction(pool, async (conn) => {
    let userId;
    try {
      const [res] = await conn.query(
        'INSERT INTO users (email, name, password_hash, is_admin) VALUES (?, ?, ?, ?)',
        [normaliseEmail(email), name.trim(), hash, isAdmin],
      );
      userId = res.insertId;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new AppError(409, 'EMAIL_EXISTS', 'já existe um utilizador com esse email');
      throw e;
    }
    const amount = fromCents(capital);
    const [p] = await conn.query(
      "INSERT INTO portfolios (user_id, currency, initial_capital, cash_balance) VALUES (?, 'EUR', ?, ?)",
      [userId, amount, amount],
    );
    await conn.query("INSERT INTO cash_movements (portfolio_id, kind, amount) VALUES (?, 'initial', ?)", [p.insertId, amount]);
    await audit(conn, userId, 'user.create', 'user', userId, { email: normaliseEmail(email), isAdmin });
    return userId;
  });
}

/** Altera a palavra-passe e termina todas as sessões do utilizador. */
export async function setPassword(pool, userId, password, hashParams) {
  const err = passwordError(password);
  if (err) throw new AppError(400, 'WEAK_PASSWORD', err);
  const hash = await hashPassword(password, hashParams);
  await withTransaction(pool, async (conn) => {
    await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
    await destroyUserSessions(conn, userId);
    await audit(conn, userId, 'user.password_change', 'user', userId);
  });
}
