/**
 * Passo de preço (tick) de um instrumento da SAXO. O esquema vem dos detalhes do instrumento:
 * { DefaultTickSize, Elements: [{ HighPrice, TickSize }] } — usa-se o primeiro escalão com preço <= HighPrice.
 * Contas em inteiros (×1e6) para evitar erros de vírgula flutuante.
 */
const S = 1e6;

export function tickFor(scheme, price) {
  const els = [...(scheme?.Elements ?? [])].sort((a, b) => a.HighPrice - b.HighPrice);
  const el = els.find((e) => Number(price) <= e.HighPrice);
  return el ? el.TickSize : (scheme?.DefaultTickSize ?? null);
}

export function isOnTick(scheme, price) {
  const tick = tickFor(scheme, price);
  if (!tick) return true; // sem esquema conhecido, deixa a SAXO validar
  const t = Math.round(tick * S);
  return t > 0 && Math.round(Number(price) * S) % t === 0;
}

/** Preço válido mais próximo, como texto sem zeros à direita ("12.34"), ou null sem esquema. */
export function nearestTick(scheme, price) {
  const tick = tickFor(scheme, price);
  if (!tick) return null;
  const t = Math.round(tick * S);
  const v = Math.max(t, Math.round(Math.round(Number(price) * S) / t) * t);
  return String(Number((v / S).toFixed(6)));
}
