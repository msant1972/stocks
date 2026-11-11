import { lastTurnover } from './format.js';

/** Sentido por omissão de cada coluna ordenável da tabela de instrumentos (Acompanhar). */
export const SORT_DEFAULT_DIR = { symbol: 'asc', volume: 'desc', turnover: 'desc', change: 'desc', best: 'desc', imbalance: 'desc' };

/**
 * Ordena localmente as linhas da tabela de instrumentos; os instrumentos sem valor ficam sempre no fim (empates por
 * símbolo). ctx.best: Map(id → { strategyId, total }) de GET /strategies/best (ordena pelo resultado da melhor
 * estratégia); ctx.book: Map(id → { imbalance }) do resumo do livro de ofertas.
 */
export function sortInstruments(items, { key, dir }, { best = null, book = null } = {}) {
  const value = {
    symbol: (i) => i.symbol,
    volume: (i) => i.latest?.volume ?? null,
    turnover: (i) => lastTurnover(i.latest),
    change: (i) => (i.latest?.changePct == null ? null : Number(i.latest.changePct)),
    best: (i) => best?.get(i.id)?.total ?? null,
    imbalance: (i) => book?.get(i.id)?.imbalance ?? null,
  }[key];
  if (!value) return items;
  const sign = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null || vb == null) return (va == null) - (vb == null) || a.symbol.localeCompare(b.symbol);
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return c * sign || a.symbol.localeCompare(b.symbol);
  });
}
