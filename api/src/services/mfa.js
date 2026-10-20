import QRCode from 'qrcode';
import { audit, withTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { decryptSecret, encryptSecret } from '../secrets.js';
import { destroyUserSessions } from '../auth/sessions.js';
import {
  generateRecoveryCodes, generateSecret, hashRecoveryCode, looksLikeRecoveryCode, otpauthUri, verifyTotp,
} from '../auth/totp.js';

/** Os segredos TOTP são cifrados com a chave do servidor; sem ela não é possível activar o 2.º factor. */
export function requireKey(cfg) {
  if (!cfg.secretKey) {
    throw new AppError(503, 'NO_SECRET_KEY', 'a chave de cifra do servidor não está configurada (/etc/stocks/secret.key)');
  }
  return cfg.secretKey;
}

/** Gera um segredo pendente (só passa a valer depois de confirmado com um código) e o QR code. */
export async function startSetup(pool, key, user) {
  const secret = generateSecret();
  await pool.query('UPDATE users SET totp_pending_enc = ? WHERE id = ?', [encryptSecret(key, secret), user.id]);
  const uri = otpauthUri(secret, user.email);
  const qrSvg = await QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  return { secret, otpauthUri: uri, qrCode: `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString('base64')}` };
}

async function replaceRecoveryCodes(conn, userId) {
  const codes = generateRecoveryCodes();
  await conn.query('DELETE FROM user_recovery_codes WHERE user_id = ?', [userId]);
  await conn.query(
    'INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ?',
    [codes.map((c) => [userId, hashRecoveryCode(c)])],
  );
  return codes;
}

/**
 * Confirma o segredo pendente com um código da aplicação. Em caso de sucesso activa o 2.º factor,
 * cria códigos de recuperação novos e termina todas as sessões do utilizador (quem chama cria uma nova).
 * Devolve os códigos de recuperação, ou null se o código estiver errado.
 */
export async function enable(pool, key, userId, code) {
  return withTransaction(pool, async (conn) => {
    const [[u]] = await conn.query('SELECT totp_pending_enc, totp_enabled_at FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (u.totp_enabled_at) throw new AppError(409, 'MFA_ALREADY_ENABLED', 'a autenticação em dois passos já está activa');
    if (!u.totp_pending_enc) throw new AppError(409, 'MFA_SETUP_NOT_STARTED', 'comece por gerar o QR code');
    const pending = u.totp_pending_enc;
    const step = verifyTotp(decryptSecret(key, pending), code);
    if (step == null) return null;
    await conn.query(
      `UPDATE users SET totp_secret_enc = ?, totp_pending_enc = NULL, totp_enabled_at = NOW(3), totp_last_step = ?
        WHERE id = ?`,
      [pending, step, userId],
    );
    const codes = await replaceRecoveryCodes(conn, userId);
    await destroyUserSessions(conn, userId);
    await audit(conn, userId, 'auth.mfa_enabled', 'user', userId);
    return codes;
  });
}

/**
 * Verifica um código da aplicação (6 dígitos) ou um código de recuperação (que fica gasto).
 * Devolve 'totp', 'recovery' ou null. Um código TOTP já aceite não volta a ser aceite.
 */
export async function verifyCode(pool, key, userId, code) {
  if (looksLikeRecoveryCode(code)) {
    const [res] = await pool.query(
      'UPDATE user_recovery_codes SET used_at = NOW(3) WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
      [userId, hashRecoveryCode(code)],
    );
    return res.affectedRows === 1 ? 'recovery' : null;
  }
  const [[u]] = await pool.query('SELECT totp_secret_enc, totp_last_step FROM users WHERE id = ?', [userId]);
  if (!u?.totp_secret_enc) return null;
  const lastStep = u.totp_last_step == null ? null : Number(u.totp_last_step);
  const step = verifyTotp(decryptSecret(key, u.totp_secret_enc), code, { lastStep });
  if (step == null) return null;
  // Condicional, para que dois pedidos simultâneos com o mesmo código não sejam ambos aceites.
  const [res] = await pool.query(
    'UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)',
    [step, userId, step],
  );
  return res.affectedRows === 1 ? 'totp' : null;
}

export async function regenerateRecoveryCodes(pool, userId) {
  return withTransaction(pool, async (conn) => {
    const codes = await replaceRecoveryCodes(conn, userId);
    await audit(conn, userId, 'auth.mfa_recovery_regenerated', 'user', userId);
    return codes;
  });
}

/** Desliga o 2.º factor e termina as sessões; no próximo login o utilizador tem de o configurar de novo. */
export async function resetMfa(conn, userId) {
  await conn.query(
    `UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL
      WHERE id = ?`,
    [userId],
  );
  await conn.query('DELETE FROM user_recovery_codes WHERE user_id = ?', [userId]);
  await destroyUserSessions(conn, userId);
}

export async function mfaStatus(pool, userId) {
  const [[r]] = await pool.query(
    `SELECT u.totp_enabled_at,
            (SELECT COUNT(*) FROM user_recovery_codes c WHERE c.user_id = u.id AND c.used_at IS NULL) AS left_codes
       FROM users u WHERE u.id = ?`,
    [userId],
  );
  return {
    enabled: r.totp_enabled_at != null,
    enabledAt: r.totp_enabled_at?.toISOString() ?? null,
    recoveryCodesLeft: Number(r.left_codes),
  };
}
