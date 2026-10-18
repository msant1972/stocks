import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

// Parâmetros recomendados pela OWASP para scrypt (N=2^17, r=8, p=1, ~128 MiB por cálculo).
const PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEY_LEN = 32;

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password, params = PARAMS) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem,
  });
  return timingSafeEqual(actual, expected);
}

// Usado quando o email não existe, para que a resposta demore o mesmo que uma verificação real.
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword('palavra-passe-inexistente');
  await verifyPassword(password, dummyHash);
}
