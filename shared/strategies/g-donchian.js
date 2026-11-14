/**
 * G-Donchian — rotura de canais (sistema 2 das «Tartarugas»), por instrumento (docs/arquitectura/Novas-estrategias.md).
 *
 * Compra quando o fecho rompe o máximo das últimas 30 sessões (sem contar a de hoje) e vende quando o fecho cai abaixo do mínimo
 * das últimas 40 sessões (as Tartarugas usavam 55 e 20; a afinação alargou a saída, que deixa correr as tendências). Entrada por rotura de preço, diferente das estratégias de médias móveis: apanha tendências que começam
 * de repente. Execução na abertura seguinte, 15 000 € por compra, uma posição de cada vez, sem stop além do canal de saída.
 */
import { resolveNumeric, rollingMax, rollingMin, runSingle } from './single.js';

// Afinada a 14 nov. 2026 (Laboratório): entrada 30 e saída 40 sessões (eram 55 e 20, as das Tartarugas).
export const DEFAULT_OPTIONS = { budget: 15000, entryN: 30, exitN: 40 };
export const resolveOptions = (options) => resolveNumeric('G-Donchian', DEFAULT_OPTIONS, options);

export function backtest(quotes, options = {}) {
  const o = resolveOptions(options);
  const res = runSingle(quotes, {
    from: o.from, budget: o.budget,
    build: (bars) => {
      const C = bars.map((b) => b.C);
      const H = bars.map((b) => b.H);
      const L = bars.map((b) => b.L);
      const hi = rollingMax(H, o.entryN, 1); // máximo das N sessões anteriores
      const lo = rollingMin(L, o.exitN, 1);
      return {
        warm: o.entryN,
        decide: (i, pos) => {
          if (!pos) return hi[i] != null && C[i] > hi[i] ? { act: 'buy' } : null;
          return lo[i] != null && C[i] < lo[i] ? { act: 'sell', reason: 'channel' } : null;
        },
      };
    },
  });
  return { ...res, options: o };
}
