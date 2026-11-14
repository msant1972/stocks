/**
 * H-Cruzamento — cruzamento de médias 50/200 («golden cross» e «death cross»), por instrumento. É a estratégia de tendência mais
 * simples e conhecida: serve de referência para comparar as outras (docs/arquitectura/Novas-estrategias.md).
 *
 * Compra quando a SMA50 cruza acima da SMA200 e vende quando cruza abaixo. Execução na abertura seguinte, 15 000 € por compra,
 * uma posição de cada vez, sem stop.
 */
import { rollingMean } from '../momentum.js';
import { resolveNumeric, runSingle } from './single.js';

export const DEFAULT_OPTIONS = { budget: 15000, fast: 50, slow: 200 };
export const resolveOptions = (options) => resolveNumeric('H-Cruzamento', DEFAULT_OPTIONS, options);

export function backtest(quotes, options = {}) {
  const o = resolveOptions(options);
  const res = runSingle(quotes, {
    from: o.from, budget: o.budget,
    build: (bars) => {
      const C = bars.map((b) => b.C);
      const fast = rollingMean(C, o.fast);
      const slow = rollingMean(C, o.slow);
      return {
        warm: o.slow,
        decide: (i, pos) => {
          if (fast[i] == null || slow[i] == null || fast[i - 1] == null || slow[i - 1] == null) return null;
          if (!pos) return fast[i] > slow[i] && fast[i - 1] <= slow[i - 1] ? { act: 'buy' } : null;
          return fast[i] < slow[i] && fast[i - 1] >= slow[i - 1] ? { act: 'sell', reason: 'cross' } : null;
        },
      };
    },
  });
  return { ...res, options: o };
}
