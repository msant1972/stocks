// Cálculo partilhado com a API (shared/), para o frontend e o servidor usarem exactamente o mesmo código.
export * from '../../../shared/strategies/a-momentum.js';
export { AVAILABLE_STRATEGIES, DEFAULT_STRATEGY_ID, getStrategy, STRATEGIES } from '../../../shared/strategies/index.js';
