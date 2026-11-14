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
 * adicionais de que precisa antes dessa janela; reasonLabels: nomes dos motivos de venda para a interface;
 * execution: preço a que o BackTest executa um sinal na data do sinal: 'close' (fecho dessa sessão) ou 'open' (abertura;
 * o sinal indica o preço em `price`, que nos stops é o próprio stop). Referência da comparação com a Automação.
 */
import { momentum } from '../momentum.js';
import * as aMomentum from './a-momentum.js';
import * as bOpus from './b-opus.js';
import * as cAi from './c-ai.js';
import * as dReversao from './d-reversao.js';
import * as eOndas from './e-ondas.js';
import * as fMergulho from './f-mergulho.js';
import * as gDonchian from './g-donchian.js';
import * as hCruzamento from './h-cruzamento.js';
import * as iMaximo52 from './i-maximo52.js';
import * as jBollinger from './j-bollinger.js';
import * as kKeltner from './k-keltner.js';
import * as lMacd from './l-macd.js';

/**
 * Anos de histórico com que os Sinais (e as regras de alerta de sinal) correm as estratégias. A A-Momentum reconstrói a
 * posição desde o início do histórico: fixar a janela mantém os sinais iguais quando a base guarda mais anos (5, para o
 * período de verificação do BackTest).
 */
export const SIGNAL_HISTORY_YEARS = 3;

/** Períodos do BackTest e do Comparar: os últimos windowYears anos, ou os windowYears anos antes deles (verificação). */
export const PERIODS = Object.freeze({ recent: 0, verification: 2 });

const eur = (v) => `${v.toLocaleString('pt-PT')} €`;

export const STRATEGIES = [
  {
    id: 'a-momentum',
    name: 'A-Momentum',
    available: true,
    budget: aMomentum.STRATEGY_BUDGET,
    execution: 'close',
    summary: `Momento do SMA10/SMA200 em tendência de subida, com reforços a cada +10% e protecção de ${aMomentum.STOP_BELOW_LAST_ADD}%`,
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
    execution: 'open',
    summary: 'Tendência e momentum ajustado ao risco, decisão semanal, reforços a +10%, stop chandelier de 4 × ATR',
    rules: `Na última sessão de cada semana, sem posição, compra ${eur(bOpus.DEFAULT_OPTIONS.budget)} na abertura seguinte quando o fecho `
      + 'e a SMA50 estão acima da SMA200, o M1 ((SMA10 − SMA125) / ATR22) e o M2 (momentum de 12 meses sem o último, '
      + `dividido pela volatilidade) são positivos, o valor negociado médio de 50 sessões é pelo menos `
      + `${eur(bOpus.DEFAULT_OPTIONS.minTradedValue)}${bOpus.DEFAULT_OPTIONS.cooldownSessions > 0 ? ` e não houve um stop nas últimas ${bOpus.DEFAULT_OPTIONS.cooldownSessions} sessões` : ''}; `
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
  {
    id: 'c-ai',
    name: 'C-AI',
    available: true,
    budget: cAi.DEFAULT_OPTIONS.budget,
    execution: 'open',
    summary: 'Tendência (SMA200) com momentum positivo, stop chandelier de 5 × ATR e reforços só com momentum forte',
    rules: `Sem posição, compra ${eur(cAi.DEFAULT_OPTIONS.budget)} na abertura seguinte quando o fecho está acima da SMA200 e o M2 `
      + '(momentum de 12 meses sem o último, dividido pela volatilidade) é positivo. Vende tudo só quando o preço toca o stop '
      + `chandelier (máximo desde a compra − ${cAi.DEFAULT_OPTIONS.stopMult} × ATR22, que só sobe), verificado todos os dias. `
      + `Reforça com mais ${eur(cAi.DEFAULT_OPTIONS.budget)} na abertura seguinte quando o fecho sobe mais de `
      + `${cAi.DEFAULT_OPTIONS.addOnGain * 100}% face ao último lote e o M2 é superior a ${cAi.DEFAULT_OPTIONS.addMinM2}, `
      + `até ${cAi.DEFAULT_OPTIONS.maxAdds} reforços. Volta a comprar logo que as condições se verifiquem depois de um stop. `
      + 'Uma posição de cada vez, sem comissões; indicadores sobre preços ajustados, execução a preços reais.',
    windowYears: 2,
    warmupYears: 1,
    reasonLabels: { stop: 'stop' },
    run: (quotes, { from } = {}) => cAi.backtest(quotes, { from }),
  },
  {
    id: 'd-reversao',
    name: 'D-Reversão',
    available: true,
    budget: dReversao.DEFAULT_OPTIONS.budget,
    execution: 'open',
    summary: 'Reversão à média: compra quedas anormais (z < −2,5 face à média de 20 sessões) e vende no ressalto',
    rules: `Sem posição, compra ${eur(dReversao.DEFAULT_OPTIONS.budget)} na abertura seguinte quando o fecho fica mais de `
      + `${String(-dReversao.DEFAULT_OPTIONS.zEntry).replace('.', ',')} desvios-padrão abaixo da média das últimas `
      + `${dReversao.DEFAULT_OPTIONS.meanN} sessões. Vende tudo na abertura seguinte quando o RSI de `
      + `${dReversao.DEFAULT_OPTIONS.rsiN} sessões passa ${dReversao.DEFAULT_OPTIONS.rsiExit} (ressalto) ou ao fim de `
      + `${dReversao.DEFAULT_OPTIONS.maxHold} sessões. Sem stop nem reforços; uma posição de cada vez, sem comissões; `
      + 'indicadores sobre preços ajustados, execução a preços reais.',
    windowYears: 2,
    warmupYears: 1,
    reasonLabels: { rebound: 'ressalto', time: 'tempo' },
    run: (quotes, { from } = {}) => dReversao.backtest(quotes, { from }),
  },
  {
    id: 'e-ondas',
    name: 'E-Ondas',
    available: true,
    budget: eOndas.DEFAULT_OPTIONS.budget,
    execution: 'close',
    summary: `Compra o fim das correcções perto da SMA200 (+${eOndas.DEFAULT_OPTIONS.up * 100} % sobre o fundo) e vende o fim das subidas (−${eOndas.DEFAULT_OPTIONS.down * 100} % sobre o topo)`,
    rules: 'Em tendência de subida (SMA200 acima da de há 20 sessões), acompanha o fecho mais baixo desde a última venda e compra '
      + `${eur(eOndas.DEFAULT_OPTIONS.budget)} ao fecho quando o fecho sobe ${eOndas.DEFAULT_OPTIONS.up * 100}% acima dele, se esse mínimo foi uma correcção `
      + `(pelo menos ${eOndas.DEFAULT_OPTIONS.minDip * 100}% abaixo do máximo de ${eOndas.DEFAULT_OPTIONS.dipN} sessões) que chegou perto da SMA200 (no máximo `
      + `${eOndas.DEFAULT_OPTIONS.near200 * 100}% acima dela); se o fundo não cumpre, esquece-o e recomeça. Com posição, acompanha o fecho mais alto desde a compra e vende tudo ao fecho quando o fecho cai `
      + `${eOndas.DEFAULT_OPTIONS.down * 100}% abaixo dele, depois de o máximo ter chegado a ${eOndas.DEFAULT_OPTIONS.minGain * 100}% sobre a compra; se ao fim de ${eOndas.DEFAULT_OPTIONS.maxHold} sessões o máximo ainda não chegou lá, `
      + 'vende (limite de tempo: a onda não aconteceu). Sem stop nem reforços; uma posição de cada vez, '
      + 'sem comissões; indicadores sobre preços ajustados, execução ao fecho real da sessão do sinal.',
    windowYears: 2,
    warmupYears: 1,
    reasonLabels: { reversal: 'inversão', time: 'limite de tempo' },
    run: (quotes, { from } = {}) => eOndas.backtest(quotes, { from }),
  },
  {
    id: 'f-mergulho',
    name: 'F-Mergulho',
    available: true,
    budget: fMergulho.DEFAULT_OPTIONS.budget,
    execution: 'open',
    summary: 'Núcleo de tendência (SMA200) e até 3 lotes que compram quedas (RSI14 < 40) e vendem a recuperação (RSI14 > 70)',
    rules: `Duas partes independentes, com lotes de ${eur(fMergulho.DEFAULT_OPTIONS.budget)}. NÚCLEO: compra na abertura seguinte quando o fecho `
      + `está mais de ${fMergulho.DEFAULT_OPTIONS.coreBand * 100}% acima da SMA200 e vende quando fica mais de ${fMergulho.DEFAULT_OPTIONS.coreBand * 100}% abaixo. `
      + `MERGULHOS (até ${fMergulho.DEFAULT_OPTIONS.maxLots} lotes): compra na abertura seguinte quando o RSI14 fecha abaixo de ${fMergulho.DEFAULT_OPTIONS.rsiIn}; `
      + `cada lote seguinte só ${fMergulho.DEFAULT_OPTIONS.spacing} sessões depois da última compra e com o fecho pelo menos `
      + `${fMergulho.DEFAULT_OPTIONS.step * 100}% abaixo do último lote. Vende todos os lotes de mergulho quando o RSI14 passa de ${fMergulho.DEFAULT_OPTIONS.rsiOut}, `
      + `ou o fecho está ${fMergulho.DEFAULT_OPTIONS.target * 100}% acima do custo médio, ou ${fMergulho.DEFAULT_OPTIONS.disaster * 100}% abaixo do lote mais barato. `
      + 'Sem reforços além dos lotes de mergulho; indicadores sobre preços ajustados, execução à abertura da sessão seguinte, sem comissões.',
    windowYears: 2,
    warmupYears: 1,
    reasonLabels: { rsi: 'recuperação (RSI)', target: 'alvo', disaster: 'protecção', trend: 'quebra da SMA200' },
    run: (quotes, { from } = {}) => fMergulho.backtest(quotes, { from }),
  },
  {
    id: 'g-donchian',
    name: 'G-Donchian',
    available: true,
    budget: gDonchian.DEFAULT_OPTIONS.budget,
    execution: 'open',
    summary: `Rotura de canais (Tartarugas): compra o máximo de ${gDonchian.DEFAULT_OPTIONS.entryN} sessões e vende o mínimo de ${gDonchian.DEFAULT_OPTIONS.exitN}`,
    rules: `Compra ${eur(gDonchian.DEFAULT_OPTIONS.budget)} na abertura seguinte quando o fecho rompe o máximo das últimas ${gDonchian.DEFAULT_OPTIONS.entryN} sessões `
      + `e vende tudo quando o fecho cai abaixo do mínimo das últimas ${gDonchian.DEFAULT_OPTIONS.exitN}. Uma posição de cada vez, sem reforços nem stop `
      + 'além do canal de saída; sem comissões; indicadores sobre preços ajustados, execução à abertura da sessão seguinte.',
    windowYears: 2, warmupYears: 1,
    reasonLabels: { channel: 'canal' },
    run: (quotes, { from } = {}) => gDonchian.backtest(quotes, { from }),
  },
  {
    id: 'h-cruzamento',
    name: 'H-Cruzamento',
    available: true,
    budget: hCruzamento.DEFAULT_OPTIONS.budget,
    execution: 'open',
    summary: 'Cruzamento de médias 50/200: compra no «golden cross» e vende no «death cross»',
    rules: `Compra ${eur(hCruzamento.DEFAULT_OPTIONS.budget)} na abertura seguinte quando a SMA${hCruzamento.DEFAULT_OPTIONS.fast} cruza acima da SMA${hCruzamento.DEFAULT_OPTIONS.slow} `
      + 'e vende tudo quando cruza abaixo. Uma posição de cada vez, sem reforços nem stop; sem comissões; indicadores sobre preços ajustados, '
      + 'execução à abertura da sessão seguinte. Estratégia de referência: a mais simples e conhecida.',
    windowYears: 2, warmupYears: 1,
    reasonLabels: { cross: 'cruzamento' },
    run: (quotes, { from } = {}) => hCruzamento.backtest(quotes, { from }),
  },
  {
    id: 'i-maximo52',
    name: 'I-Máximo52',
    available: true,
    budget: iMaximo52.DEFAULT_OPTIONS.budget,
    execution: 'open',
    summary: `Compra perto do máximo de ${iMaximo52.DEFAULT_OPTIONS.lookback} sessões (George e Hwang) e vende quando cai ${iMaximo52.DEFAULT_OPTIONS.exit * 100} % abaixo dele`,
    rules: `Compra ${eur(iMaximo52.DEFAULT_OPTIONS.budget)} na abertura seguinte quando o fecho está a ${iMaximo52.DEFAULT_OPTIONS.enter * 100}% ou menos do máximo das últimas `
      + `${iMaximo52.DEFAULT_OPTIONS.lookback} sessões e vende tudo quando cai mais de ${iMaximo52.DEFAULT_OPTIONS.exit * 100}% abaixo desse máximo. Uma posição de cada vez, `
      + 'sem reforços; sem comissões; indicadores sobre preços ajustados, execução à abertura da sessão seguinte.',
    windowYears: 2, warmupYears: 1,
    reasonLabels: { drawdown: 'queda do máximo' },
    run: (quotes, { from } = {}) => iMaximo52.backtest(quotes, { from }),
  },
  {
    id: 'j-bollinger',
    name: 'J-Bollinger',
    available: true,
    budget: jBollinger.DEFAULT_OPTIONS.budget,
    execution: 'open',
    summary: `Reversão nas bandas de Bollinger (${jBollinger.DEFAULT_OPTIONS.n} sessões, ${jBollinger.DEFAULT_OPTIONS.k} desvios): compra abaixo da banda inferior e vende na média`,
    rules: `Compra ${eur(jBollinger.DEFAULT_OPTIONS.budget)} na abertura seguinte quando o fecho fica abaixo da banda inferior (média de ${jBollinger.DEFAULT_OPTIONS.n} sessões `
      + `menos ${jBollinger.DEFAULT_OPTIONS.k} desvios-padrão) e vende tudo quando volta à média, ou ao fim de ${jBollinger.DEFAULT_OPTIONS.maxHold} sessões sem lá chegar. `
      + 'Uma posição de cada vez, sem reforços nem stop; sem comissões; indicadores sobre preços ajustados, execução à abertura da sessão seguinte.',
    windowYears: 2, warmupYears: 1,
    reasonLabels: { mean: 'média', time: 'tempo' },
    run: (quotes, { from } = {}) => jBollinger.backtest(quotes, { from }),
  },
  {
    id: 'k-keltner',
    name: 'K-Keltner',
    available: true,
    budget: kKeltner.DEFAULT_OPTIONS.budget,
    execution: 'open',
    summary: `Rotura do canal de Keltner: compra acima da EMA${kKeltner.DEFAULT_OPTIONS.n} + ${kKeltner.DEFAULT_OPTIONS.k} ATR e vende abaixo da EMA${kKeltner.DEFAULT_OPTIONS.n}`,
    rules: `Compra ${eur(kKeltner.DEFAULT_OPTIONS.budget)} na abertura seguinte quando o fecho rompe a banda superior (EMA de ${kKeltner.DEFAULT_OPTIONS.n} sessões mais `
      + `${kKeltner.DEFAULT_OPTIONS.k} × ATR de ${kKeltner.DEFAULT_OPTIONS.atrN}) e vende tudo quando cai abaixo da EMA. Uma posição de cada vez, sem reforços nem stop; `
      + 'sem comissões; indicadores sobre preços ajustados, execução à abertura da sessão seguinte.',
    windowYears: 2, warmupYears: 1,
    reasonLabels: { middle: 'média' },
    run: (quotes, { from } = {}) => kKeltner.backtest(quotes, { from }),
  },
  {
    id: 'l-macd',
    name: 'L-MACD',
    available: true,
    budget: lMacd.DEFAULT_OPTIONS.budget,
    execution: 'open',
    summary: 'MACD (12, 26, 9): compra quando cruza acima da linha de sinal e vende quando cruza abaixo',
    rules: `Compra ${eur(lMacd.DEFAULT_OPTIONS.budget)} na abertura seguinte quando o MACD (EMA${lMacd.DEFAULT_OPTIONS.fast} − EMA${lMacd.DEFAULT_OPTIONS.slow}) cruza acima da sua `
      + `linha de sinal (EMA${lMacd.DEFAULT_OPTIONS.signal}) e vende tudo quando cruza abaixo. Uma posição de cada vez, sem reforços nem stop; sem comissões; `
      + 'indicadores sobre preços ajustados, execução à abertura da sessão seguinte.',
    windowYears: 2, warmupYears: 1,
    reasonLabels: { cross: 'cruzamento' },
    run: (quotes, { from } = {}) => lMacd.backtest(quotes, { from }),
  },
];

export const DEFAULT_STRATEGY_ID = 'a-momentum';

/**
 * As estratégias de sempre das análises que dependem de um conjunto fixo (validação das Promessas, «ganhador nas estratégias»,
 * persistência dos ganhadores): uma estratégia nova não passa a contar nelas sem se refazerem essas análises.
 */
export const ANALYSIS_STRATEGIES = ['a-momentum', 'b-opus', 'c-ai', 'd-reversao'].map((id) => STRATEGIES.find((s) => s.id === id));
export const AVAILABLE_STRATEGIES = STRATEGIES.filter((s) => s.available);

/** Estratégia disponível com este id, ou null (inexistente ou ainda em preparação). */
export function getStrategy(id) {
  const s = STRATEGIES.find((x) => x.id === id);
  return s?.available ? s : null;
}
