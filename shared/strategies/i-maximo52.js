/**
 * I-Máximo52 — proximidade do máximo de 52 semanas (George e Hwang, 2004), por instrumento. Os preços perto do máximo anual tendem
 * a continuar a subir, porque os investidores ancoram no máximo e reagem devagar às boas notícias.
 *
 * Compra quando o fecho está a 10 % ou menos do máximo das últimas 126 sessões (o fecho de hoje conta) e vende quando cai mais de
 * 15 % abaixo desse máximo (a versão original de George e Hwang usa 52 semanas, 252 sessões; a afinação deu melhor com 6 meses). Execução na abertura seguinte, 15 000 € por compra, uma posição de cada vez.
 */
import { resolveNumeric, rollingMax, runSingle } from './single.js';

// Afinada a 14 nov. 2026 (Laboratório): 126 sessões, entrada a 10 % e saída 15 % abaixo do máximo (eram 252, 5 % e 10 %).
export const DEFAULT_OPTIONS = { budget: 15000, lookback: 126, enter: 0.10, exit: 0.15 };
export const resolveOptions = (options) => resolveNumeric('I-Máximo52', DEFAULT_OPTIONS, options);

export function backtest(quotes, options = {}) {
  const o = resolveOptions(options);
  const res = runSingle(quotes, {
    from: o.from, budget: o.budget,
    build: (bars) => {
      const C = bars.map((b) => b.C);
      const hi = rollingMax(C, o.lookback, 0);
      return {
        warm: o.lookback - 1,
        decide: (i, pos) => {
          if (hi[i] == null) return null;
          if (!pos) return C[i] >= hi[i] * (1 - o.enter) ? { act: 'buy' } : null;
          return C[i] < hi[i] * (1 - o.exit) ? { act: 'sell', reason: 'drawdown' } : null;
        },
      };
    },
  });
  return { ...res, options: o };
}
