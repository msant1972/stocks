/**
 * Posição de cada estratégia pelo resultado sobre o capital máximo investido, em várias condições (listas de
 * StrategyStats de GET /strategies/compare). Empates partilham a posição (1 + estratégias estritamente melhores).
 * stable: as mesmas posições em todas as condições. Função pura (node --test).
 */
export function rankings(lists) {
  const rankIn = (items, id) => {
    const v = items.find((x) => x.id === id)?.returnOnPeakPct ?? null;
    return { value: v, rank: v == null ? null : 1 + items.filter((x) => x.returnOnPeakPct > v).length };
  };
  const base = lists[0] ?? [];
  const rows = base.map((s) => ({ id: s.id, name: s.name, cells: lists.map((items) => rankIn(items, s.id)) }));
  rows.sort((a, b) => a.cells[0].rank - b.cells[0].rank || a.name.localeCompare(b.name));
  const stable = rows.every((r) => r.cells.every((c) => c.rank === r.cells[0].rank));
  return { rows, stable };
}
