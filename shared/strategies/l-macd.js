/**
 * L-MACD — cruzamento do MACD com a linha de sinal, por instrumento (docs/arquitectura/Novas-estrategias.md). Variante de momentum
 * muito usada em plataformas de retalho.
 *
 * MACD = EMA12 − EMA26 do fecho ajustado; sinal = EMA9 do MACD. Compra quando o MACD cruza acima do sinal e vende quando cruza
 * abaixo. Execução na abertura seguinte, 15 000 € por compra, uma posição de cada vez, sem stop.
 */
import { ema, resolveNumeric, runSingle } from './single.js';

export const DEFAULT_OPTIONS = { budget: 15000, fast: 12, slow: 26, signal: 9 };
export const resolveOptions = (options) => resolveNumeric('L-MACD', DEFAULT_OPTIONS, options);

export function backtest(quotes, options = {}) {
  const o = resolveOptions(options);
  const res = runSingle(quotes, {
    from: o.from, budget: o.budget,
    build: (bars) => {
      const C = bars.map((b) => b.C);
      const f = ema(C, o.fast);
      const s = ema(C, o.slow);
      const macd = C.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
      const firstIdx = macd.findIndex((v) => v != null);
      const sig = new Array(C.length).fill(null);
      if (firstIdx >= 0) {
        const part = ema(macd.slice(firstIdx), o.signal);
        part.forEach((v, k) => { sig[firstIdx + k] = v; });
      }
      return {
        warm: o.slow + o.signal,
        decide: (i, pos) => {
          if (sig[i] == null || sig[i - 1] == null) return null;
          if (!pos) return macd[i] > sig[i] && macd[i - 1] <= sig[i - 1] ? { act: 'buy' } : null;
          return macd[i] < sig[i] && macd[i - 1] >= sig[i - 1] ? { act: 'sell', reason: 'cross' } : null;
        },
      };
    },
  });
  return { ...res, options: o };
}
