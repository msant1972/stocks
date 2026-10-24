/**
 * Registo das estratégias simuladas no histórico. Usado pelo frontend (gráfico do instrumento, BackTest,
 * Sinais) e pela API (/backtest, /signals), para que todos corram exactamente o mesmo código.
 *
 * Para acrescentar uma estratégia: criar shared/strategies/<id>.js e registá-la aqui com available: true e
 * uma função run(quotes, { mom }) que devolva o mesmo formato que a A-Momentum:
 *   {
 *     trades: [{ buyDate, sellDate, quantity, cost, avgPrice, lots: [{ date, price, quantity, cost }],
 *                reinforcements, sellPrice, proceeds, pnl, pnlPct }],
 *     open: null | { buyDate, quantity, cost, avgPrice, lots, reinforcements, lastDate, lastPrice, value, pnl, pnlPct },
 *     signals: [{ date, side: 'buy' | 'add' | 'sell' }],      // marcadores do gráfico e página Sinais
 *     firstDate,                                               // primeira sessão em que a estratégia pode actuar
 *     summary: { closed, wins, reinforcements, peakCost, realized, unrealized, total, totalPct,
 *                buyHold: null | { startDate, quantity, cost, value, pnl, pnlPct } },
 *     ...campos próprios (ex.: skipped e sellsHeld na A-Momentum)
 *   }
 * quotes: sessões em ordem cronológica com date, close (real), adjClose, sma10, sma125, sma200 (e ema9, sma50
 * quando a fonte os inclui); mom: momentum(quotes), já calculado pelo gráfico (opcional).
 */
import { momentum } from '../momentum.js';
import * as aMomentum from './a-momentum.js';

const eur = (v) => `${v.toLocaleString('pt-PT')} €`;

export const STRATEGIES = [
  {
    id: 'a-momentum',
    name: 'A-Momentum',
    available: true,
    budget: aMomentum.STRATEGY_BUDGET,
    summary: 'Momento do SMA10/SMA200 com reforços a cada +10%',
    rules: `Compra ${eur(aMomentum.STRATEGY_BUDGET)} quando o SMA10/SMA200 tem uma sessão «a descer» seguida de duas «a subir»; `
      + `reforça com mais ${eur(aMomentum.STRATEGY_BUDGET)} sempre que o fecho sobe mais de ${aMomentum.REINFORCE_GAIN}% face à compra mais recente; `
      + `vende tudo após uma «a subir» seguida de duas «a descer», mas só com o SMA8/SMA125 abaixo de ${aMomentum.SELL_MAX_WAVE125}%. `
      + `Sinais ignorados com o SMA10/SMA200 entre −${aMomentum.NEUTRAL_BAND}% e +${aMomentum.NEUTRAL_BAND}%. `
      + 'Executa ao fecho da sessão do sinal, uma posição de cada vez, sem comissões.',
    run: (quotes, { mom } = {}) => aMomentum.backtest(quotes, mom ?? momentum(quotes)),
  },
  {
    id: 'b-opus',
    name: 'B-Opus',
    available: false, // regras a definir; aparece nos menus como «em preparação»
    budget: null,
    summary: 'Em preparação',
    rules: 'Estratégia em preparação.',
    run: null,
  },
];

export const DEFAULT_STRATEGY_ID = 'a-momentum';
export const AVAILABLE_STRATEGIES = STRATEGIES.filter((s) => s.available);

/** Estratégia disponível com este id, ou null (inexistente ou ainda em preparação). */
export function getStrategy(id) {
  const s = STRATEGIES.find((x) => x.id === id);
  return s?.available ? s : null;
}
