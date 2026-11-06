import { STRATEGY_BUDGET } from './strategy.js';

/**
 * Quantidade por omissão de uma compra: as unidades inteiras que cabem no orçamento das estratégias
 * (15 000 €) ao preço dado, no mínimo 1. Sem preço conhecido, 1.
 */
export function budgetQuantity(price, budget = STRATEGY_BUDGET) {
  const p = Number(price);
  return p > 0 ? Math.max(1, Math.floor(budget / p)) : 1;
}
