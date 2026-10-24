/**
 * C-AI — tendência com momentum e reforços selectivos, por instrumento (docs/arquitectura/C-AI.md).
 *
 * Sem posição, compra 15 000 € na abertura seguinte quando o fecho ajustado está acima da SMA200 e o M2
 * (momentum 12-1 / volatilidade) é positivo. Sai só pelo stop chandelier (máximo desde a compra − 5 × ATR22,
 * só sobe), verificado todos os dias sobre a posição inteira. Reforça com mais 15 000 € na abertura seguinte
 * quando o fecho sobe mais de 10% face ao último lote e o M2 é superior a 2, até 5 reforços. Reentra sem
 * arrefecimento. Sem comissões.
 *
 * Indicadores e stop sobre a série ajustada (OHLC × adjClose/close); execução e resultados em preços reais.
 * Sem lookahead: a decisão no fecho de t usa só dados até t.
 */
import { rollingMean } from '../momentum.js';
import { atrWilder, m2Series, prepare } from './b-opus.js';

export const DEFAULT_OPTIONS = {
  budget: 15000,
  smaTrend: 200,
  atrN: 22,
  m2Lookback: 252, m2Skip: 21,
  minHistory: 253,
  stopMult: 5,
  addOnGain: 0.10,
  addMinM2: 2,
  maxAdds: 5,
};

/** Valida e completa as opções (chaves desconhecidas e valores inválidos → erro). */
export function resolveOptions(options = {}) {
  const { from, ...rest } = options;
  for (const [k, v] of Object.entries(rest)) {
    if (!(k in DEFAULT_OPTIONS)) throw new Error(`C-AI: opção desconhecida «${k}»`);
    const negativeOk = k === 'addMinM2';
    if (typeof v !== 'number' || !Number.isFinite(v) || (!negativeOk && v < 0)) {
      throw new Error(`C-AI: «${k}» deve ser um número${negativeOk ? '' : ' não negativo'}`);
    }
  }
  if (from != null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('C-AI: «from» deve ser AAAA-MM-DD');
  return { ...DEFAULT_OPTIONS, ...rest, from: from ?? null };
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Simula a C-AI num instrumento. quotes: sessões em ordem cronológica com date, open, high, low, close (brutos),
 * adjClose e volume. options.from: primeira data em que a estratégia pode comprar (os indicadores usam todo o
 * histórico recebido). Devolve o formato comum do registo de estratégias.
 */
export function backtest(quotes, options = {}) {
  const o = resolveOptions(options);
  const { bars, dataQuality } = prepare(quotes);
  const C = bars.map((b) => b.C);
  const sma = rollingMean(C, o.smaTrend);
  const atr = atrWilder(bars, o.atrN);
  const m2 = m2Series(C, o.m2Lookback, o.m2Skip);

  const warm = o.minHistory - 1;
  const fromPos = o.from ? bars.findIndex((b) => b.date >= o.from) : 0;
  const startIdx = fromPos < 0 || bars.length === 0 ? -1 : Math.max(warm, fromPos);
  const canAct = startIdx >= 0 && startIdx < bars.length;

  const trades = [];
  const signals = [];
  let peakCost = 0;
  let adds = 0;
  let pos = null;          // posição aberta
  let pendingBuy = null;   // { atr } do dia do sinal
  let pendingAdd = false;

  const real = (adjPrice, i) => adjPrice / bars[i].f;

  const closePos = (i, adjPrice) => {
    const price = real(adjPrice, i);
    const proceeds = round2(pos.quantity * price);
    trades.push({
      buyDate: pos.buyDate, sellDate: bars[i].date, quantity: pos.quantity, cost: pos.cost,
      avgPrice: pos.cost / pos.quantity, lots: pos.lots, reinforcements: pos.lots.length - 1,
      sellPrice: price, proceeds, reason: 'stop', initialStop: real(pos.initialStop, pos.entryIdx),
      pnl: round2(proceeds - pos.cost), pnlPct: (proceeds / pos.cost - 1) * 100,
    });
    signals.push({ date: bars[i].date, side: 'sell', reason: 'stop', price });
    pos = null;
    pendingAdd = false;
  };

  const buyLot = (i) => {
    const price = real(bars[i].O, i);
    const quantity = Math.floor(o.budget / price);
    if (quantity < 1) return null;
    return { date: bars[i].date, price, quantity, cost: round2(quantity * price) };
  };

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];

    // --- Abertura ---
    if (pos && b.O <= pos.stop) closePos(i, b.O);
    if (pos && pendingAdd) {
      const lot = buyLot(i);
      if (lot) {
        pos.lots.push(lot);
        pos.quantity += lot.quantity;
        pos.cost = round2(pos.cost + lot.cost);
        peakCost = Math.max(peakCost, pos.cost);
        adds += 1;
        signals.push({ date: b.date, side: 'add', price: lot.price });
      }
    }
    pendingAdd = false;
    if (!pos && pendingBuy) {
      const lot = buyLot(i);
      if (lot) {
        const stop = b.O - o.stopMult * pendingBuy.atr;
        pos = {
          buyDate: b.date, entryIdx: i, quantity: lot.quantity, cost: lot.cost, lots: [lot],
          highestHigh: b.O, initialStop: stop, stop,
        };
        peakCost = Math.max(peakCost, lot.cost);
        signals.push({ date: b.date, side: 'buy', price: lot.price });
      }
    }
    pendingBuy = null;

    // --- Durante a sessão ---
    if (pos && b.L <= pos.stop) closePos(i, pos.stop);

    // --- Fecho ---
    if (pos) {
      pos.highestHigh = Math.max(pos.highestHigh, b.H);
      if (atr[i] != null) pos.stop = Math.max(pos.stop, pos.highestHigh - o.stopMult * atr[i]);
      const room = o.maxAdds === 0 || pos.lots.length - 1 < o.maxAdds;
      if (o.addOnGain > 0 && room && m2[i] != null && m2[i] > o.addMinM2
        && b.closeRaw > pos.lots.at(-1).price * (1 + o.addOnGain)) pendingAdd = true;
      continue;
    }
    if (!canAct || i < startIdx) continue;
    if (sma[i] != null && m2[i] != null && atr[i] != null && b.C > sma[i] && m2[i] > 0) pendingBuy = { atr: atr[i] };
  }

  const lastIdx = bars.length - 1;
  let open = null;
  if (pos) {
    const lastPrice = bars[lastIdx].closeRaw;
    const value = round2(pos.quantity * lastPrice);
    open = {
      buyDate: pos.buyDate, quantity: pos.quantity, cost: pos.cost, avgPrice: pos.cost / pos.quantity,
      lots: pos.lots, reinforcements: pos.lots.length - 1, lastDate: bars[lastIdx].date, lastPrice, value,
      pnl: round2(value - pos.cost), pnlPct: (value / pos.cost - 1) * 100,
      stop: real(pos.stop, lastIdx), initialStop: real(pos.initialStop, pos.entryIdx),
    };
  }

  // Comparação: o orçamento investido na primeira sessão em que a estratégia pode actuar, mantido até ao fim.
  let buyHold = null;
  if (canAct) {
    const p0 = bars[startIdx].closeRaw;
    const qty = Math.floor(o.budget / p0);
    if (qty > 0) {
      const cost = round2(qty * p0);
      const value = round2(qty * bars[lastIdx].closeRaw);
      buyHold = { startDate: bars[startIdx].date, quantity: qty, cost, value, pnl: round2(value - cost), pnlPct: (value / cost - 1) * 100 };
    }
  }

  const realized = round2(trades.reduce((s, t) => s + t.pnl, 0));
  const total = round2(realized + (open?.pnl ?? 0));
  return {
    trades, open, signals,
    firstDate: canAct ? bars[startIdx].date : null,
    summary: {
      closed: trades.length,
      wins: trades.filter((t) => t.pnl > 0).length,
      reinforcements: adds,
      peakCost: round2(peakCost),
      realized,
      unrealized: open?.pnl ?? 0,
      total,
      totalPct: peakCost > 0 ? (total / peakCost) * 100 : 0,
      buyHold,
    },
    dataQuality,
    options: o,
  };
}
