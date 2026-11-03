/**
 * Velas com preços ajustados: o mesmo factor adjClose/close do fecho é aplicado à abertura, ao máximo e ao mínimo,
 * como nas estratégias (shared/strategies/b-opus.js, prepare), para as velas serem contínuas nos dividendos e
 * desdobramentos. Cotações sem abertura, máximo ou mínimo usam o fecho. O máximo e o mínimo nunca ficam
 * dentro do corpo da vela.
 */
export function adjustedOhlc(q) {
  const close = Number(q.close);
  const adj = Number(q.adjClose ?? q.close);
  const k = close > 0 ? adj / close : 1;
  const open = q.open == null ? close : Number(q.open);
  const high = q.high == null ? close : Number(q.high);
  const low = q.low == null ? close : Number(q.low);
  const o = open * k;
  const c = adj;
  return { o, c, h: Math.max(high * k, o, c), l: Math.min(low * k, o, c) };
}
