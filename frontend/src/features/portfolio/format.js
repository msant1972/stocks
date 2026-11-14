/** Formatação e textos do Portfolio Recomendado (funções puras, testadas em frontend/test/portfolioPage.test.js). */

export const pct1 = (v) => (v == null ? '—' : `${v.toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
export const signedPct = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${pct1(Math.abs(v))}`);
export const tone = (v) => (v > 0 ? 'positive' : v < 0 ? 'negative' : '');

/** Carteira por sector: [{ sector, count, weight }], do maior peso para o menor. */
export function bySector(positions) {
  const m = new Map();
  for (const p of positions) {
    const key = p.sector ?? 'Sem sector';
    const row = m.get(key) ?? { sector: key, count: 0, weight: 0 };
    row.count += 1;
    row.weight += p.weight ?? 0;
    m.set(key, row);
  }
  return [...m.values()].sort((a, b) => b.weight - a.weight || a.sector.localeCompare(b.sector));
}

/**
 * Estado da última revisão, para o texto do cartão: 'pending' (decidida ao último fecho; as ordens são para a abertura da sessão
 * seguinte), 'done' (já executada na simulação) ou 'none' (ainda sem revisões).
 */
export function reviewState(review) {
  if (!review?.date) return 'none';
  return review.executed ? 'done' : 'pending';
}
