/**
 * Estratégia de momento sobre o SMA10/SMA200 (área do gráfico de momento), simulada no histórico:
 *   compra 15 000 € quando as três últimas sessões foram «a descer», «a subir», «a subir»;
 *   vende tudo quando foram «a subir», «a descer», «a descer».
 * Execução ao fecho real (não ajustado) da sessão em que o padrão se completa; uma posição de
 * cada vez; quantidades inteiras; sem comissões. Não altera a carteira virtual.
 */

export const STRATEGY_BUDGET = 15000;

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
 * Devolve { trades, open, summary, firstDate, signals }.
 */
export function backtest(quotes, mom, budget = STRATEGY_BUDGET) {
  const states = sessionStates(mom);
  const trades = [];
  const signals = []; // { date, side } para os marcadores do gráfico
  let open = null;
  for (let i = 0; i < quotes.length; i++) {
    const price = Number(quotes[i].close);
    if (!open && matches(states, i, BUY)) {
      const quantity = Math.floor(budget / price);
      if (quantity < 1) continue;
      open = { buyDate: quotes[i].date, buyPrice: price, quantity, cost: round2(quantity * price) };
      signals.push({ date: quotes[i].date, side: 'buy' });
    } else if (open && matches(states, i, SELL)) {
      const proceeds = round2(open.quantity * price);
      trades.push({ ...open, sellDate: quotes[i].date, sellPrice: price, proceeds, pnl: round2(proceeds - open.cost), pnlPct: (proceeds / open.cost - 1) * 100 });
      signals.push({ date: quotes[i].date, side: 'sell' });
      open = null;
    }
  }

  const last = quotes.at(-1);
  if (open && last) {
    const value = round2(open.quantity * Number(last.close));
    open = { ...open, lastDate: last.date, lastPrice: Number(last.close), value, pnl: round2(value - open.cost), pnlPct: (value / open.cost - 1) * 100 };
  }

  // Comparação: comprar e manter o mesmo orçamento desde a primeira sessão com estado conhecido.
  const startIdx = states.findIndex((s) => s != null);
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

  const realized = round2(trades.reduce((s, t) => s + t.pnl, 0));
  const total = round2(realized + (open?.pnl ?? 0));
  return {
    trades, open, signals,
    firstDate: startIdx >= 0 ? quotes[startIdx].date : null,
    summary: {
      closed: trades.length,
      wins: trades.filter((t) => t.pnl > 0).length,
      realized,
      unrealized: open?.pnl ?? 0,
      total,
      totalPct: (total / budget) * 100,
      buyHold,
    },
  };
}
