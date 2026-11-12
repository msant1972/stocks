// RSI de Wilder, partilhado com a D-Reversão (shared/strategies/d-reversao.js): o mesmo cálculo na interface e na estratégia.
import { rsiWilder } from '../../../shared/strategies/d-reversao.js';

export const RSI_PERIOD = 14;

/** RSI14 de cada sessão sobre o fecho ajustado (null nas primeiras 14 sessões). quotes: sessões em ordem cronológica. */
export function rsiSeries(quotes, n = RSI_PERIOD) {
  return rsiWilder(quotes.map((q) => Number(q.adjClose ?? q.close)), n);
}

/** Zona do RSI: «sobrecomprado» (≥ 70), «sobrevendido» (≤ 30) ou null. */
export function rsiZone(v) {
  if (v == null) return null;
  return v >= 70 ? 'sobrecomprado' : v <= 30 ? 'sobrevendido' : null;
}
