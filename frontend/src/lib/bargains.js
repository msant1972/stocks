/** Página «Pechinchas»: nomes dos critérios e ordenação. */

export const CRITERIA_LABELS = { sector: 'sector', history: 'P/E histórico', analysts: 'analistas', graham: 'Graham' };

/** Critérios que dizem «barato», por extenso: «sector, analistas, Graham». */
export function bargainCriteria(criteria) {
  return Object.entries(CRITERIA_LABELS).filter(([k]) => criteria?.[k] === 'cheap').map(([, label]) => label).join(', ');
}

/**
 * Ordena por uma coluna; valores em falta ficam sempre no fim. Em «cheap» desempata pela fracção de critérios e
 * depois pela margem dos analistas; o símbolo é o último desempate.
 */
export function sortBargains(rows, { key, dir }) {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (r) => (key === 'cheap' ? (r.total ? r.cheap + r.cheap / r.total / 10 : null) : r[key]);
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null || vb == null) {
      if (va == null && vb == null) return a.symbol.localeCompare(b.symbol);
      return va == null ? 1 : -1;
    }
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    if (c) return c * sign;
    if (key === 'cheap') {
      const ua = a.upside ?? -Infinity;
      const ub = b.upside ?? -Infinity;
      if (ua !== ub) return ub - ua;
    }
    return a.symbol.localeCompare(b.symbol);
  });
}
