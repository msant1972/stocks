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
 * quotes: sessões em ordem cronológica com date, open, high, low, close (reais), adjClose, volume, sma10, sma125,
 * sma200; mom: momentum(quotes), já calculado pelo gráfico (opcional); from: primeira data em que a estratégia
 * pode comprar (as anteriores servem só de aquecimento dos indicadores).
 *
 * windowYears: anos em que a estratégia actua (BackTest e página do instrumento); warmupYears: anos de histórico
 * adicionais de que precisa antes dessa janela; reasonLabels: nomes dos motivos de venda para a interface.
 */
import { momentum } from '../momentum.js';
import * as aMomentum from './a-momentum.js';
import * as bOpus from './b-opus.js';

const eur = (v) => `${v.toLocaleString('pt-PT')} €`;

export const STRATEGIES = [
  {
    id: 'a-momentum',
    name: 'A-Momentum',
    available: true,
    budget: aMomentum.STRATEGY_BUDGET,
    summary: 'Momento do SMA10/SMA200 em tendência de subida, com reforços a cada +10% e protecção de 15%',
    rules: `Compra ${eur(aMomentum.STRATEGY_BUDGET)} quando o SMA10/SMA200 tem uma sessão «a descer» seguida de duas «a subir», `
      + 'só com o preço acima da sua média de 200 sessões (não compra acções em queda); '
      + `reforça com mais ${eur(aMomentum.STRATEGY_BUDGET)} sempre que o fecho sobe mais de ${aMomentum.REINFORCE_GAIN}% face à compra mais recente; `
      + `vende tudo após uma «a subir» seguida de duas «a descer», mas só com o SMA8/SMA125 abaixo de ${aMomentum.SELL_MAX_WAVE125}%, `
      + `ou, com a posição reforçada, quando o fecho cai mais de ${aMomentum.STOP_BELOW_LAST_ADD}% abaixo do preço do último reforço. `
      + `Sinais ignorados com o SMA10/SMA200 entre −${aMomentum.NEUTRAL_BAND}% e +${aMomentum.NEUTRAL_BAND}%. `
      + 'Executa ao fecho da sessão do sinal, uma posição de cada vez, sem comissões.',
    windowYears: 2,
    warmupYears: 0,
    reasonLabels: { signal: 'padrão de venda', stop: 'protecção' },
    run: (quotes, { mom } = {}) => aMomentum.backtest(quotes, mom ?? momentum(quotes)),
  },
  {
    id: 'b-opus',
    name: 'B-Opus',
    available: true,
    budget: bOpus.DEFAULT_OPTIONS.budget,
    summary: 'Tendência e momentum ajustado ao risco, decisão semanal, reforços a +10%, stop chandelier de 4 × ATR',
    rules: `Na última sessão de cada semana, sem posição, compra ${eur(bOpus.DEFAULT_OPTIONS.budget)} na abertura seguinte quando o fecho `
      + 'e a SMA50 estão acima da SMA200, o M1 ((SMA10 − SMA125) / ATR22) e o M2 (momentum de 12 meses sem o último, '
      + `dividido pela volatilidade) são positivos, o valor negociado médio de 50 sessões é pelo menos `
      + `${eur(bOpus.DEFAULT_OPTIONS.minTradedValue)} e não houve um stop nas últimas ${bOpus.DEFAULT_OPTIONS.cooldownSessions} sessões; `
      + 'não compra se a abertura subir mais de 1 ATR face ao fecho. '
      + `Reforça com mais ${eur(bOpus.DEFAULT_OPTIONS.budget)} na abertura seguinte sempre que o fecho sobe mais de `
      + `${bOpus.DEFAULT_OPTIONS.addOnGain * 100}% face ao último lote (até ${bOpus.DEFAULT_OPTIONS.maxAdds} reforços). `
      + `Vende tudo se o preço tocar o stop chandelier (máximo desde a compra − ${bOpus.DEFAULT_OPTIONS.stopMult} × ATR22, que só sobe), `
      + 'ou, na revisão semanal, por falta de liquidez, quebra de tendência, perda de momento ou ao fim de '
      + `${bOpus.DEFAULT_OPTIONS.timeStopSessions} sessões sem ganhar 1 ATR (venda na abertura seguinte). `
      + 'Uma posição de cada vez, sem comissões; indicadores sobre preços ajustados, execução a preços reais.',
    windowYears: 2,
    warmupYears: 1,
    reasonLabels: {
      stop: 'stop', trend_break: 'tendência', momentum_loss: 'momento', liquidity: 'liquidez',
      time_stop: 'tempo', partial_take_profit: 'metade',
    },
    run: (quotes, { from } = {}) => bOpus.backtest(quotes, { from }),
  },
];

export const DEFAULT_STRATEGY_ID = 'a-momentum';
export const AVAILABLE_STRATEGIES = STRATEGIES.filter((s) => s.available);

/** Estratégia disponível com este id, ou null (inexistente ou ainda em preparação). */
export function getStrategy(id) {
  const s = STRATEGIES.find((x) => x.id === id);
  return s?.available ? s : null;
}
