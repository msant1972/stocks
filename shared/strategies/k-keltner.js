/**
 * K-Keltner — rotura do canal de Keltner, por instrumento (docs/arquitectura/Novas-estrategias.md).
 *
 * Compra quando o fecho rompe a banda superior (média móvel exponencial de 120 sessões mais 1 × ATR de 10 sessões) e vende quando
 * cai abaixo dessa média (o canal clássico usa 20 sessões e 2 × ATR; a afinação deu melhor com uma média lenta). Rotura de volatilidade: a banda alarga com o ATR, por isso filtra as roturas pequenas. Execução na
 * abertura seguinte, 15 000 € por compra, uma posição de cada vez.
 */
import { atrWilder } from './b-opus.js';
import { ema, resolveNumeric, runSingle } from './single.js';

// Afinada a 14 nov. 2026 (Laboratório): EMA de 120 sessões e 1 × ATR (eram 20 e 2 × ATR).
export const DEFAULT_OPTIONS = { budget: 15000, n: 120, atrN: 10, k: 1 };
export const resolveOptions = (options) => resolveNumeric('K-Keltner', DEFAULT_OPTIONS, options);

export function backtest(quotes, options = {}) {
  const o = resolveOptions(options);
  const res = runSingle(quotes, {
    from: o.from, budget: o.budget,
    build: (bars) => {
      const C = bars.map((b) => b.C);
      const mid = ema(C, o.n);
      const atr = atrWilder(bars, o.atrN);
      return {
        warm: Math.max(o.n, o.atrN + 1),
        decide: (i, pos) => {
          if (mid[i] == null || atr[i] == null) return null;
          if (!pos) return C[i] > mid[i] + o.k * atr[i] ? { act: 'buy' } : null;
          return C[i] < mid[i] ? { act: 'sell', reason: 'middle' } : null;
        },
      };
    },
  });
  return { ...res, options: o };
}
