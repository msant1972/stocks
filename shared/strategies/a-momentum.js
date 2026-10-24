/**
 * A-Momentum — estratégia de momento sobre o SMA10/SMA200 (área do gráfico de momento), simulada no histórico:
 *   compra 15 000 € quando as três últimas sessões foram «a descer», «a subir», «a subir» e o fecho ajustado
 *   está acima da SMA200 (filtro de tendência: não compra acções em queda);
 *   vende tudo quando foram «a subir», «a descer», «a descer» e o SMA8/SMA125 está abaixo de 1%;
 *   reforça com mais 15 000 € sempre que o fecho ultrapassa em mais de 10% o preço da compra mais recente;
 *   com a posição reforçada, vende tudo se o fecho cair mais de 15% abaixo do preço do último reforço
 *   (protecção dos reforços: não devolver o ganho todo quando a acção sobe e depois cai).
 * Filtro e protecção acrescentados a 24 out. 2026 depois da análise do BackTest: perdas dos 10 piores de
 * −172 k€ para −48 k€, com menos lucro nas tendências fortes (ver docs/arquitectura/arquitectura.md §5.4).
 * Sem compras nem vendas quando, na sessão do sinal, o SMA10/SMA200 está entre −1% e +1% (inclusive).
 * Execução ao fecho real (não ajustado) da sessão em que o padrão se completa; uma posição de
 * cada vez; quantidades inteiras; sem comissões. Não altera a carteira virtual.
 */

export const STRATEGY_BUDGET = 15000;
/** Zona neutra do SMA10/SMA200, em %: dentro dela os sinais são ignorados. */
export const NEUTRAL_BAND = 1;
/** A venda só se executa com o SMA8/SMA125 abaixo deste valor, em %. */
export const SELL_MAX_WAVE125 = 1;
/** Compra de reforço (mais um orçamento) quando o fecho sobe mais do que isto desde a última compra, em %. */
export const REINFORCE_GAIN = 10;
/** Protecção dos reforços: queda máxima, em %, abaixo do preço do último reforço. */
export const STOP_BELOW_LAST_ADD = 15;

const BUY = [false, true, true];
const SELL = [true, false, false];
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Estado de cada sessão: true «a subir», false «a descer», null quando ainda não há SMA10/SMA200
 * nas duas sessões anteriores (o estado não é conhecido).
 */
export function sessionStates(mom) {
  return mom.map((m, i) => (i >= 2 && m.wave != null && mom[i - 1].wave != null && mom[i - 2].wave != null ? m.rising : null));
}

const matches = (states, i, pattern) => i >= 2 && pattern.every((p, k) => states[i - 2 + k] === p);

/**
 * quotes: sessões em ordem cronológica, com date e close (fecho real); mom: saída de momentum().
 * Devolve { trades, open, summary, firstDate, signals, skipped, sellsHeld }.
 */
/**
 * Opções, para comparar variantes (DEFAULT_OPTIONS são as regras em vigor):
 *   trendFilter: condição para a compra inicial — 'none'; 'above' (fecho ajustado acima da SMA200);
 *                'rising' (SMA200 acima da de trendLookback sessões antes); 'either' (uma das duas);
 *   stopPct:     numa posição com reforços, vende tudo quando o fecho cai mais do que isto (%) abaixo do
 *                preço do último reforço; null desliga;
 *   stopFrom:    'lastAdd' (preço do último reforço) ou 'peak' (fecho mais alto desde o último reforço);
 *   maxAdds:     máximo de reforços por posição; null sem limite.
 */
export const DEFAULT_OPTIONS = { trendFilter: 'above', trendLookback: 20, stopPct: STOP_BELOW_LAST_ADD, stopFrom: 'lastAdd', maxAdds: null };
/** As regras antes do filtro e da protecção (para comparação). */
export const ORIGINAL_OPTIONS = { trendFilter: 'none', stopPct: null };

export function backtest(quotes, mom, budget = STRATEGY_BUDGET, options = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const adj = (i) => Number(quotes[i].adjClose ?? quotes[i].close);
  const sma200 = (i) => (quotes[i]?.sma200 == null ? null : Number(quotes[i].sma200));
  const trendOk = (i) => {
    if (opt.trendFilter === 'none') return true;
    const above = sma200(i) != null && adj(i) > sma200(i);
    const prev = sma200(i - opt.trendLookback);
    const rising = sma200(i) != null && prev != null && sma200(i) > prev;
    return opt.trendFilter === 'above' ? above : opt.trendFilter === 'rising' ? rising : above || rising;
  };
  const states = sessionStates(mom);
  const trades = [];
  const signals = []; // { date, side: 'buy' | 'add' | 'sell' } para os marcadores do gráfico
  let open = null;    // { buyDate, quantity, cost, lots: [{ date, price, quantity, cost }] }
  let skipped = 0;    // sinais na zona neutra do SMA10/SMA200
  let sellsHeld = 0;  // padrões de venda não executados por o SMA8/SMA125 estar em 1% ou mais
  let peakCost = 0;   // capital máximo investido em simultâneo
  let trendBlocked = 0; // compras não feitas pelo filtro de tendência
  let stops = 0;        // vendas pela protecção dos reforços

  const addLot = (i, price) => {
    const quantity = Math.floor(budget / price);
    if (quantity < 1) return false;
    const lot = { date: quotes[i].date, price, quantity, cost: round2(quantity * price) };
    if (!open) open = { buyDate: lot.date, quantity: 0, cost: 0, lots: [] };
    open.lots.push(lot);
    open.quantity += lot.quantity;
    open.cost = round2(open.cost + lot.cost);
    peakCost = Math.max(peakCost, open.cost);
    return true;
  };

  for (let i = 0; i < quotes.length; i++) {
    const price = Number(quotes[i].close);
    const neutral = mom[i].wave != null && Math.abs(mom[i].wave) <= NEUTRAL_BAND;

    if (!open) {
      if (!matches(states, i, BUY)) continue;
      if (neutral) { skipped += 1; continue; }
      if (!trendOk(i)) { trendBlocked += 1; continue; }
      if (addLot(i, price)) signals.push({ date: quotes[i].date, side: 'buy' });
      continue;
    }

    const close = (reason) => {
      const proceeds = round2(open.quantity * price);
      trades.push({
        ...open, avgPrice: open.cost / open.quantity, reinforcements: open.lots.length - 1,
        sellDate: quotes[i].date, sellPrice: price, proceeds, reason,
        pnl: round2(proceeds - open.cost), pnlPct: (proceeds / open.cost - 1) * 100,
      });
      signals.push({ date: quotes[i].date, side: 'sell', reason });
      open = null;
    };

    // Protecção dos reforços: com a posição reforçada, uma queda de stopPct abaixo do último reforço
    // fecha tudo (sem esperar pelo padrão de venda, que só chega depois de uma descida grande).
    if (open.lots.length > 1) open.peakSinceAdd = Math.max(open.peakSinceAdd ?? 0, price);
    const stopRef = opt.stopFrom === 'peak' ? open.peakSinceAdd : open.lots.at(-1).price;
    if (opt.stopPct != null && open.lots.length > 1 && price < stopRef * (1 - opt.stopPct / 100)) {
      stops += 1;
      close('stop');
      continue;
    }

    if (matches(states, i, SELL)) {
      if (neutral) {
        skipped += 1;
      } else if (!(mom[i].wave125 != null && mom[i].wave125 < SELL_MAX_WAVE125)) {
        sellsHeld += 1;
      } else {
        close('signal');
        continue;
      }
    }

    // Reforço: fecho acima do preço da compra mais recente em mais de REINFORCE_GAIN. Medir desde a
    // última compra (e não sobre o custo médio) evita reforços diários quando a posição já é grande,
    // porque mais um orçamento quase não mexe no custo médio. Comparação em cêntimos inteiros, para
    // que um ganho de exactamente 10% não «ultrapasse» por erro de vírgula flutuante.
    const lastLotCents = Math.round(open.lots.at(-1).price * 100);
    const priceCents = Math.round(price * 100);
    const canAdd = opt.maxAdds == null || open.lots.length - 1 < opt.maxAdds;
    if (canAdd && priceCents * 100 > lastLotCents * (100 + REINFORCE_GAIN) && addLot(i, price)) {
      open.peakSinceAdd = price;
      signals.push({ date: quotes[i].date, side: 'add' });
    }
  }

  const last = quotes.at(-1);
  if (open && last) {
    const value = round2(open.quantity * Number(last.close));
    open = {
      ...open, avgPrice: open.cost / open.quantity, reinforcements: open.lots.length - 1,
      lastDate: last.date, lastPrice: Number(last.close), value,
      pnl: round2(value - open.cost), pnlPct: (value / open.cost - 1) * 100,
    };
  }

  // Comparação: comprar e manter o orçamento de uma compra desde a primeira sessão com estado conhecido.
  const startIdx = states.findIndex((st) => st != null);
  let buyHold = null;
  if (startIdx >= 0 && last) {
    const p0 = Number(quotes[startIdx].close);
    const qty = Math.floor(budget / p0);
    if (qty > 0) {
      const cost = round2(qty * p0);
      const value = round2(qty * Number(last.close));
      buyHold = { startDate: quotes[startIdx].date, quantity: qty, cost, value, pnl: round2(value - cost), pnlPct: (value / cost - 1) * 100 };
    }
  }

  const realized = round2(trades.reduce((sum, t) => sum + t.pnl, 0));
  const total = round2(realized + (open?.pnl ?? 0));
  return {
    trades, open, signals, skipped, sellsHeld, trendBlocked, stops,
    firstDate: startIdx >= 0 ? quotes[startIdx].date : null,
    summary: {
      closed: trades.length,
      wins: trades.filter((t) => t.pnl > 0).length,
      reinforcements: signals.filter((x) => x.side === 'add').length,
      peakCost: round2(peakCost),
      realized,
      unrealized: open?.pnl ?? 0,
      total,
      // Percentagem sobre o capital máximo investido em simultâneo (com reforços pode exceder uma compra).
      totalPct: peakCost > 0 ? (total / peakCost) * 100 : 0,
      buyHold,
    },
  };
}
