import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';

/**
 * Cifra de segredos guardados na BD (ex.: palavra-passe SMTP), partilhada com o motor de alertas.
 * Formato: "v1:" + base64(iv[12] | tag[16] | texto cifrado), AES-256-GCM.
 * A chave (32 bytes em base64) vem de STOCKS_SECRET_KEY ou do ficheiro STOCKS_SECRET_KEY_FILE.
 */
export function loadSecretKey(env = process.env) {
  let b64 = env.STOCKS_SECRET_KEY;
  if (!b64 && env.STOCKS_SECRET_KEY_FILE && fs.existsSync(env.STOCKS_SECRET_KEY_FILE)) {
    b64 = fs.readFileSync(env.STOCKS_SECRET_KEY_FILE, 'utf8').trim();
  }
  if (!b64) return null;
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('a chave de cifra deve ter 32 bytes em base64');
  return key;
}

export function encryptSecret(key, plaintext, iv = randomBytes(12)) {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
}

export function decryptSecret(key, value) {
  if (!value.startsWith('v1:')) throw new Error('formato de segredo desconhecido');
  const raw = Buffer.from(value.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
