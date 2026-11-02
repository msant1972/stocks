/**
 * D-Reversão — reversão à média, por instrumento (docs/arquitectura/D-Reversao.md).
 *
 * Sem posição, compra 15 000 € na abertura seguinte quando o fecho ajustado fica mais de 2,5 desvios-padrão abaixo
 * da média das últimas 20 sessões (z < −2,5). Vende tudo na abertura seguinte quando o RSI de 2 sessões passa 70
 * (o ressalto aconteceu) ou ao fim de 10 sessões sem ressalto. Sem stop nem reforços. Sem comissões.
 *
 * Indicadores sobre a série ajustada (OHLC × adjClose/close); execução e resultados em preços reais.
 * Sem lookahead: a decisão no fecho de t usa só dados até t.
 */
import { rollingMean } from '../momentum.js';
import { prepare, rollingStd } from './b-opus.js';

export const DEFAULT_OPTIONS = {
  budget: 15000,
  meanN: 20,       // média e desvio-padrão do z
  zEntry: -2.5,    // compra com z abaixo disto
  rsiN: 2,
  rsiExit: 70,     // vende com o RSI acima disto
  maxHold: 10,     // sessões máximas com a posição (0 = sem limite)
};

/** Valida e completa as opções (chaves desconhecidas e valores inválidos → erro). */
export function resolveOptions(options = {}) {
  const { from, ...rest } = options;
  for (const [k, v] of Object.entries(rest)) {
    if (!(k in DEFAULT_OPTIONS)) throw new Error(`D-Reversão: opção desconhecida «${k}»`);
    const negativeOk = k === 'zEntry';
    if (typeof v !== 'number' || !Number.isFinite(v) || (!negativeOk && v < 0)) {
      throw new Error(`D-Reversão: «${k}» deve ser um número${negativeOk ? '' : ' não negativo'}`);
    }
  }
  if (from != null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('D-Reversão: «from» deve ser AAAA-MM-DD');
  return { ...DEFAULT_OPTIONS, ...rest, from: from ?? null };
}

/** RSI de Wilder (semente: média dos primeiros n ganhos e perdas). */
export function rsiWilder(closes, n) {
  const out = new Array(closes.length).fill(null);
  let up = 0;
  let down = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const u = Math.max(d, 0);
    const v = Math.max(-d, 0);
    if (i <= n) {
      up += u;
      down += v;
      if (i < n) continue;
      up /= n;
      down /= n;
    } else {
      up = (up * (n - 1) + u) / n;
      down = (down * (n - 1) + v) / n;
    }
    out[i] = down === 0 ? 100 : 100 - 100 / (1 + up / down);
  }
  return out;
}

/** z de cada sessão: (fecho − média de n) / desvio-padrão de n. */
export function zScore(closes, n) {
  const mean = rollingMean(closes, n);
  const sd = rollingStd(closes, n);
  return closes.map((c, i) => (mean[i] == null || !sd[i] ? null : (c - mean[i]) / sd[i]));
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Simula a D-Reversão num instrumento. quotes: sessões em ordem cronológica com date, open, high, low, close
 * (brutos), adjClose e volume. options.from: primeira data em que a estratégia pode comprar (os indicadores usam
 * todo o histórico recebido). Devolve o formato comum do registo de estratégias.
 */
export function backtest(quotes, options = {}) {
  const o = resolveOptions(options);
  const { bars, dataQuality } = prepare(quotes);
  const C = bars.map((b) => b.C);
  const z = zScore(C, o.meanN);
  const rsi = rsiWilder(C, o.rsiN);

  const warm = o.meanN - 1;
  const fromPos = o.from ? bars.findIndex((b) => b.date >= o.from) : 0;
  const startIdx = fromPos < 0 || bars.length === 0 ? -1 : Math.max(warm, fromPos);
  const canAct = startIdx >= 0 && startIdx < bars.length;

  const trades = [];
  const signals = [];
  const exitReasons = { rebound: 0, time: 0 };
  let peakCost = 0;
  let pos = null;            // posição aberta
  let pendingBuy = false;
  let pendingSell = null;    // motivo da venda planeada

  const real = (adjPrice, i) => adjPrice / bars[i].f;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];

    // --- Abertura ---
    if (pos && pendingSell) {
      const price = real(b.O, i);
      const proceeds = round2(pos.quantity * price);
      trades.push({
        buyDate: pos.buyDate, sellDate: b.date, quantity: pos.quantity, cost: pos.cost,
        avgPrice: pos.cost / pos.quantity, lots: pos.lots, reinforcements: 0,
        sellPrice: price, proceeds, reason: pendingSell,
        pnl: round2(proceeds - pos.cost), pnlPct: (proceeds / pos.cost - 1) * 100,
      });
      signals.push({ date: b.date, side: 'sell', reason: pendingSell, price });
      exitReasons[pendingSell] += 1;
      pos = null;
    }
    pendingSell = null;
    if (!pos && pendingBuy) {
      const price = real(b.O, i);
      const quantity = Math.floor(o.budget / price);
      if (quantity >= 1) {
        const lot = { date: b.date, price, quantity, cost: round2(quantity * price) };
        pos = { buyDate: b.date, entryIdx: i, quantity, cost: lot.cost, lots: [lot] };
        peakCost = Math.max(peakCost, lot.cost);
        signals.push({ date: b.date, side: 'buy', price });
      }
    }
    pendingBuy = false;
    if (i === bars.length - 1) break; // sem sessão seguinte para executar decisões

    // --- Fecho ---
    if (pos) {
      if (rsi[i] != null && rsi[i] > o.rsiExit) pendingSell = 'rebound';
      else if (o.maxHold > 0 && i - pos.entryIdx >= o.maxHold) pendingSell = 'time';
      continue;
    }
    if (!canAct || i < startIdx) continue;
    if (z[i] != null && z[i] < o.zEntry) pendingBuy = true;
  }

  const lastIdx = bars.length - 1;
  let open = null;
  if (pos) {
    const lastPrice = bars[lastIdx].closeRaw;
    const value = round2(pos.quantity * lastPrice);
    open = {
      buyDate: pos.buyDate, quantity: pos.quantity, cost: pos.cost, avgPrice: pos.cost / pos.quantity,
      lots: pos.lots, reinforcements: 0, lastDate: bars[lastIdx].date, lastPrice, value,
      pnl: round2(value - pos.cost), pnlPct: (value / pos.cost - 1) * 100,
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
      reinforcements: 0,
      peakCost: round2(peakCost),
      realized,
      unrealized: open?.pnl ?? 0,
      total,
      totalPct: peakCost > 0 ? (total / peakCost) * 100 : 0,
      buyHold,
    },
    exitReasons,
    dataQuality,
    options: o,
  };
}
