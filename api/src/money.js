/**
 * Aritmética decimal exacta com BigInt. Os valores circulam como strings (ex.: "1234.50"),
 * tal como chegam das colunas DECIMAL, e nunca passam por Number.
 * Arredondamento: meio para longe de zero (ROUND do MariaDB).
 */

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** "12.345" com escala 2 -> 1235n (arredondado). */
export function toScaled(value, scale) {
  const str = String(value).trim();
  if (!DECIMAL_RE.test(str)) throw new Error(`valor decimal inválido: ${value}`);
  const negative = str.startsWith('-');
  const [intPart, fracPart = ''] = str.replace('-', '').split('.');
  const keep = fracPart.slice(0, scale).padEnd(scale, '0');
  let n = BigInt(intPart + keep);
  const next = fracPart.charCodeAt(scale);
  if (next >= 53 /* '5' */) n += 1n;
  return negative ? -n : n;
}

/** 1235n com escala 2 -> "12.35". */
export function fromScaled(n, scale) {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(scale + 1, '0');
  const out = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative && n !== 0n ? `-${out}` : out;
}

/** Divisão inteira com arredondamento meio para longe de zero. */
export function roundDiv(a, b) {
  if (b === 0n) throw new Error('divisão por zero');
  const negative = (a < 0n) !== (b < 0n);
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const q = (absA * 2n + absB) / (absB * 2n);
  return negative ? -q : q;
}

/** Montante em cêntimos de quantity × price (price com até 6 casas). */
export function amountCents(quantity, price) {
  return roundDiv(BigInt(quantity) * toScaled(price, 6), 10_000n);
}

export const cents = (value) => toScaled(value, 2);
export const fromCents = (n) => fromScaled(n, 2);

/** Rácio a/b com `scale` casas decimais, como string. */
export function ratio(a, b, scale) {
  return fromScaled(roundDiv(a * 10n ** BigInt(scale), b), scale);
}
