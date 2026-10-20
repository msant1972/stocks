import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) com os parâmetros que todas as aplicações de autenticação suportam:
 * HMAC-SHA1, 6 dígitos, passos de 30 s. Aceita ±1 passo para relógios ligeiramente desacertados.
 */
export const STEP_SECONDS = 30;
export const DIGITS = 6;
export const WINDOW = 1;
export const ISSUER = 'Stocks';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('segredo base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Segredo novo de 160 bits (recomendação do RFC 4226), em base32. */
export const generateSecret = () => base32Encode(randomBytes(20));

/** Código para um passo de tempo (RFC 4226 §5.3, truncagem dinâmica). */
export function hotp(secretB32, counter, digits = DIGITS, algorithm = 'sha1') {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algorithm, base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);
export const totp = (secretB32, ms = Date.now()) => hotp(secretB32, stepAt(ms));

/**
 * Verifica um código. Devolve o passo que coincidiu, ou null. lastStep impede reutilizar um código
 * já aceite (ou um anterior), o que protege contra quem o observe ou intercepte.
 */
export function verifyTotp(secretB32, code, { now = Date.now(), lastStep = null, window = WINDOW } = {}) {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const current = stepAt(now);
  for (let d = -window; d <= window; d++) {
    const step = current + d;
    if (lastStep != null && step <= lastStep) continue;
    const expected = Buffer.from(hotp(secretB32, step));
    if (timingSafeEqual(expected, Buffer.from(c))) return step;
  }
  return null;
}

/** URI otpauth:// lida pelas aplicações de autenticação (formato Key Uri do Google Authenticator). */
export function otpauthUri(secretB32, account, issuer = ISSUER) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${q}`;
}

// ---------- Códigos de recuperação ----------

export const RECOVERY_CODES = 10;
const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // sem caracteres ambíguos (0/o, 1/l/i)

/** 10 códigos «xxxxx-xxxxx» (≈ 49 bits cada), mostrados ao utilizador uma única vez. */
export function generateRecoveryCodes(n = RECOVERY_CODES) {
  return Array.from({ length: n }, () => {
    const bytes = randomBytes(10);
    const s = Array.from(bytes, (b) => RC_ALPHABET[b % RC_ALPHABET.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const normaliseRecoveryCode = (code) => String(code ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const hashRecoveryCode = (code) => createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
export const looksLikeRecoveryCode = (code) => normaliseRecoveryCode(code).length === 10;
