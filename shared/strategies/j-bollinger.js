/**
 * J-Bollinger — reversão à média nas bandas de Bollinger, por instrumento (docs/arquitectura/Novas-estrategias.md).
 *
 * Compra quando o fecho fica abaixo da banda inferior (média de 40 sessões menos 1,5 desvios-padrão) e vende quando volta à média
 * (banda do meio), ou ao fim de 80 sessões sem lá chegar (as bandas clássicas são 20 sessões e 2 desvios; a afinação alargou-as). Execução na abertura seguinte, 15 000 € por compra, uma posição de cada
 * vez, sem stop. Reversão como a D-Reversão, mas com bandas de volatilidade em vez do z-score e do RSI.
 */
import { rollingMean } from '../momentum.js';
import { rollingStd } from './b-opus.js';
import { resolveNumeric, runSingle } from './single.js';

// Afinada a 14 nov. 2026 (Laboratório): média de 40 sessões, 1,5 desvios-padrão e 80 sessões de espera (eram 20, 2 e 20).
export const DEFAULT_OPTIONS = { budget: 15000, n: 40, k: 1.5, maxHold: 80 };
export const resolveOptions = (options) => resolveNumeric('J-Bollinger', DEFAULT_OPTIONS, options);

export function backtest(quotes, options = {}) {
  const o = resolveOptions(options);
  const res = runSingle(quotes, {
    from: o.from, budget: o.budget,
    build: (bars) => {
      const C = bars.map((b) => b.C);
      const mid = rollingMean(C, o.n);
      const sd = rollingStd(C, o.n);
      return {
        warm: o.n,
        decide: (i, pos) => {
          if (mid[i] == null || sd[i] == null) return null;
          if (!pos) return sd[i] > 0 && C[i] < mid[i] - o.k * sd[i] ? { act: 'buy' } : null; // sem variação, não há banda
          if (C[i] >= mid[i]) return { act: 'sell', reason: 'mean' };
          return o.maxHold > 0 && i - pos.entryIdx >= o.maxHold ? { act: 'sell', reason: 'time' } : null;
        },
      };
    },
  });
  return { ...res, options: o };
}
