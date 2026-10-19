/**
 * Decimal exacto para preços do livro de ofertas: BigInt com 8 casas implícitas.
 * O parsing é independente da cultura: só aceita "." como separador decimal e nenhum de milhares.
 */
export const SCALE = 8;
const ONE = 10n ** BigInt(SCALE);
const DECIMAL_RE = /^[+-]?(\d+)(?:\.(\d+))?$/;

/** "2.56" → 256000000n; devolve null se não for um número decimal válido. */
export function parseDecimal(value) {
  const m = DECIMAL_RE.exec(String(value ?? '').trim());
  if (!m) return null;
  const frac = (m[2] ?? '').slice(0, SCALE).padEnd(SCALE, '0');
  const n = BigInt(m[1]) * ONE + BigInt(frac || '0');
  return String(value).trim().startsWith('-') ? -n : n;
}

/** 256000000n → "2.56" (sem zeros à direita, mínimo `minDecimals` casas). */
export function formatDecimal(n, minDecimals = 0) {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const int = abs / ONE;
  let frac = (abs % ONE).toString().padStart(SCALE, '0').replace(/0+$/, '');
  if (frac.length < minDecimals) frac = frac.padEnd(minDecimals, '0');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** Número de casas decimais significativas de um decimal. */
export function decimalPlaces(n) {
  const frac = ((n < 0n ? -n : n) % ONE).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return frac.length;
}

export const mulInt = (price, qty) => price * BigInt(qty);
export const halve = (n) => n / 2n; // SCALE de 8 casas: a metade de um preço com ≤ 7 casas é exacta
export const toNumber = (n) => Number(n) / Number(ONE);
