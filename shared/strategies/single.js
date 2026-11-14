/**
 * Motor comum das estratégias de «uma posição de cada vez» (G a L): cada uma só descreve os indicadores e as regras de entrada e
 * de saída; o motor trata da execução, dos lotes, dos sinais, do comprar e manter e do formato comum do registo de estratégias.
 *
 * Decisão ao fecho da sessão i, execução na abertura da sessão seguinte, a preços reais (`execution: 'open'`); indicadores sobre
 * o fecho ajustado (série de prepare, de b-opus.js). Sem lookahead, sem reforços, sem comissões (os custos estimados são
 * calculados à parte, shared/costs.js). Um lote de `budget` euros, quantidades inteiras.
 */
import { prepare } from './b-opus.js';

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * quotes: sessões em ordem cronológica (date, open, high, low, close, adjClose, volume). from: primeira data em que pode comprar.
 * build(bars) devolve { warm, decide }: `warm` é a primeira sessão com todos os indicadores; decide(i, pos) devolve
 * { act: 'buy' } sem posição, { act: 'sell', reason } com posição, ou null. pos = { entryIdx, entryAdj, highestClose, bars }.
 */
export function runSingle(quotes, { from = null, budget, build }) {
  const { bars, dataQuality } = prepare(quotes);
  const n = bars.length;
  const { warm, decide } = build(bars);
  const fromPos = from ? bars.findIndex((b) => b.date >= from) : 0;
  const startIdx = fromPos < 0 || n === 0 ? -1 : Math.max(warm, fromPos);
  const canAct = startIdx >= 0 && startIdx < n;

  const trades = [];
  const signals = [];
  const exitReasons = {};
  let peakCost = 0;
  let pos = null;
  let pending = null; // { act, reason }
  const real = (adj, i) => adj / bars[i].f;

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    // --- Abertura: executa a decisão do fecho anterior ---
    if (pending?.act === 'sell' && pos) {
      const price = real(b.O, i);
      const proceeds = round2(pos.quantity * price);
      trades.push({
        buyDate: pos.buyDate, sellDate: b.date, quantity: pos.quantity, cost: pos.cost, avgPrice: pos.cost / pos.quantity,
        lots: pos.lots, reinforcements: 0, sellPrice: price, proceeds, reason: pending.reason,
        pnl: round2(proceeds - pos.cost), pnlPct: (proceeds / pos.cost - 1) * 100,
      });
      signals.push({ date: b.date, side: 'sell', reason: pending.reason, price });
      exitReasons[pending.reason] = (exitReasons[pending.reason] ?? 0) + 1;
      pos = null;
    } else if (pending?.act === 'buy' && !pos) {
      const price = real(b.O, i);
      const quantity = Math.floor(budget / price);
      if (quantity >= 1) {
        const lot = { date: b.date, price, quantity, cost: round2(quantity * price) };
        pos = { buyDate: b.date, entryIdx: i, entryAdj: b.O, highestClose: b.O, quantity, cost: lot.cost, lots: [lot] };
        peakCost = Math.max(peakCost, lot.cost);
        signals.push({ date: b.date, side: 'buy', price });
      }
    }
    pending = null;
    if (i === n - 1) break; // sem sessão seguinte para executar decisões
    if (pos) pos.highestClose = Math.max(pos.highestClose, b.C);
    if (!canAct || i < startIdx) continue;
    const d = decide(i, pos ? { ...pos, bars } : null);
    if (d && ((d.act === 'buy' && !pos) || (d.act === 'sell' && pos))) pending = d;
  }

  const lastIdx = n - 1;
  let open = null;
  if (pos) {
    const lastPrice = bars[lastIdx].closeRaw;
    const value = round2(pos.quantity * lastPrice);
    open = {
      buyDate: pos.buyDate, quantity: pos.quantity, cost: pos.cost, avgPrice: pos.cost / pos.quantity, lots: pos.lots, reinforcements: 0,
      lastDate: bars[lastIdx].date, lastPrice, value, pnl: round2(value - pos.cost), pnlPct: (value / pos.cost - 1) * 100,
    };
  }
  let buyHold = null;
  if (canAct) {
    const p0 = bars[startIdx].closeRaw;
    const qty = Math.floor(budget / p0);
    if (qty > 0) {
      const cost = round2(qty * p0);
      const value = round2(qty * bars[lastIdx].closeRaw);
      buyHold = { startDate: bars[startIdx].date, quantity: qty, cost, value, pnl: round2(value - cost), pnlPct: (value / cost - 1) * 100 };
    }
  }
  const realized = round2(trades.reduce((s, t) => s + t.pnl, 0));
  const total = round2(realized + (open?.pnl ?? 0));
  return {
    trades, open, signals, firstDate: canAct ? bars[startIdx].date : null,
    summary: {
      closed: trades.length, wins: trades.filter((t) => t.pnl > 0).length, reinforcements: 0, peakCost: round2(peakCost),
      realized, unrealized: open?.pnl ?? 0, total, totalPct: peakCost > 0 ? (total / peakCost) * 100 : 0, buyHold,
    },
    exitReasons, dataQuality,
  };
}

/** Valida opções numéricas não negativas contra os valores por omissão (chaves desconhecidas → erro); `from` opcional. */
export function resolveNumeric(name, defaults, options = {}) {
  const { from, ...rest } = options;
  for (const [k, v] of Object.entries(rest)) {
    if (!(k in defaults)) throw new Error(`${name}: opção desconhecida «${k}»`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${name}: «${k}» deve ser um número não negativo`);
  }
  if (from != null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error(`${name}: «from» deve ser AAAA-MM-DD`);
  return { ...defaults, ...rest, from: from ?? null };
}

/** Média móvel exponencial (semente: média simples dos primeiros n valores); null antes. */
export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

/** Máximo móvel dos n valores que terminam em i−lag (lag = 0 inclui i; lag = 1 só as sessões anteriores); null antes. */
export function rollingMax(values, n, lag = 0) {
  return values.map((_, i) => (i - lag >= n - 1 ? Math.max(...values.slice(i - lag - n + 1, i - lag + 1)) : null));
}
export function rollingMin(values, n, lag = 0) {
  return values.map((_, i) => (i - lag >= n - 1 ? Math.min(...values.slice(i - lag - n + 1, i - lag + 1)) : null));
}
