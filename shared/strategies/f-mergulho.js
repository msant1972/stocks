/**
 * F-Mergulho — núcleo de tendência + ciclos de mergulho, por instrumento (desenhada a 13 nov. 2026 sobre a ASML.AS; Laboratório,
 * experiência 31).
 *
 * Duas partes independentes, com lotes de 15 000 €:
 *  - NÚCLEO (1 lote): compra na abertura seguinte quando o fecho está mais de 3 % acima da SMA200; vende quando fica mais de 3 %
 *    abaixo dela (acompanha a tendência longa);
 *  - MERGULHOS (até 3 lotes): compra com o RSI14 abaixo de 40 (os lotes seguintes só 10 sessões depois da última compra e com o
 *    fecho pelo menos 5 % abaixo do último lote); vende todos os lotes de mergulho quando o RSI14 passa de 70 (recuperação), ou o
 *    fecho está 20 % acima do custo médio (alvo), ou 25 % abaixo do lote mais barato (protecção).
 *
 * Indicadores sobre o fecho ajustado (série de prepare, de b-opus.js); decisão ao fecho e execução na abertura seguinte, a preços
 * reais. Sem lookahead. Sem comissões (os custos estimados são calculados à parte, shared/costs.js).
 *
 * As duas partes podem estar abertas ao mesmo tempo: no formato comum do registo cada venda fecha uma operação (campo `leg`:
 * 'core' ou 'dip') e a posição aberta junta os lotes das duas partes. Atenção: na Automação uma venda fecha a posição inteira do
 * instrumento na SAXO, por isso a F-Mergulho não deve ser ligada lá enquanto a venda de um mergulho puder vender também o núcleo.
 */
import { rollingMean } from '../momentum.js';
import { prepare } from './b-opus.js';
import { rsiWilder } from './d-reversao.js';

export const DEFAULT_OPTIONS = {
  budget: 15000,
  core: 1,          // núcleo de tendência ligado (0 = só mergulhos)
  smaTrend: 200,    // média de tendência do núcleo
  coreBand: 0.03,   // banda em torno da SMA200: compra acima, vende abaixo
  rsiN: 14,
  rsiIn: 40,        // mergulho: compra com o RSI abaixo disto
  rsiOut: 70,       // mergulho: vende com o RSI acima disto
  maxLots: 3,       // lotes de mergulho em simultâneo
  spacing: 10,      // sessões mínimas entre compras de mergulho
  step: 0.05,       // cada lote seguinte só com o fecho pelo menos isto abaixo do último lote
  target: 0.20,     // vende os mergulhos com o fecho isto acima do custo médio (0 = sem alvo)
  disaster: 0.25,   // vende os mergulhos com o fecho isto abaixo do lote mais barato (0 = sem protecção)
};

/** Valida e completa as opções (chaves desconhecidas e valores inválidos → erro). */
export function resolveOptions(options = {}) {
  const { from, ...rest } = options;
  for (const [k, v] of Object.entries(rest)) {
    if (!(k in DEFAULT_OPTIONS)) throw new Error(`F-Mergulho: opção desconhecida «${k}»`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`F-Mergulho: «${k}» deve ser um número não negativo`);
  }
  if (from != null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('F-Mergulho: «from» deve ser AAAA-MM-DD');
  return { ...DEFAULT_OPTIONS, ...rest, from: from ?? null };
}

const round2 = (v) => Math.round(v * 100) / 100;
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

/**
 * Simula a F-Mergulho num instrumento. quotes: sessões em ordem cronológica com date, open, high, low, close (brutos), adjClose e
 * volume. options.from: primeira data em que a estratégia pode comprar (os indicadores usam todo o histórico recebido). Devolve o
 * formato comum do registo de estratégias.
 */
export function backtest(quotes, options = {}) {
  const o = resolveOptions(options);
  const { bars, dataQuality } = prepare(quotes);
  const C = bars.map((b) => b.C);
  const n = C.length;
  const sma = rollingMean(C, o.smaTrend);
  const rsi = rsiWilder(C, o.rsiN);

  const fromPos = o.from ? bars.findIndex((b) => b.date >= o.from) : 0;
  const startIdx = fromPos < 0 || n === 0 ? -1 : fromPos;
  const canAct = startIdx >= 0 && startIdx < n;

  const trades = [];
  const signals = [];
  const exitReasons = {};
  let peakCost = 0;
  let core = null;     // lote do núcleo: { date, price, quantity, cost }
  let dip = [];        // lotes de mergulho abertos
  let lastDipBuy = -Infinity;
  let pending = [];    // decisões do fecho anterior: { act, reason }

  const real = (adjPrice, i) => adjPrice / bars[i].f;
  const exposure = () => (core?.cost ?? 0) + sum(dip, (l) => l.cost);
  const newLot = (i) => {
    const price = real(bars[i].O, i);
    const quantity = Math.floor(o.budget / price);
    return quantity < 1 ? null : { date: bars[i].date, price, quantity, cost: round2(quantity * price) };
  };
  const closeLots = (i, lots, leg, reason) => {
    const price = real(bars[i].O, i);
    const quantity = sum(lots, (l) => l.quantity);
    const cost = round2(sum(lots, (l) => l.cost));
    const proceeds = round2(quantity * price);
    trades.push({
      buyDate: lots[0].date, sellDate: bars[i].date, quantity, cost, avgPrice: cost / quantity, lots,
      reinforcements: lots.length - 1, sellPrice: price, proceeds, reason, leg,
      pnl: round2(proceeds - cost), pnlPct: (proceeds / cost - 1) * 100,
    });
    signals.push({ date: bars[i].date, side: 'sell', reason, leg, price });
    exitReasons[reason] = (exitReasons[reason] ?? 0) + 1;
  };

  for (let i = 0; i < n; i++) {
    // --- Abertura: executa o que se decidiu ao fecho anterior ---
    for (const { act, reason } of pending) {
      if (act === 'corebuy' && !core) {
        const lot = newLot(i);
        if (lot) {
          signals.push({ date: lot.date, side: dip.length ? 'add' : 'buy', leg: 'core', price: lot.price });
          core = lot;
        }
      } else if (act === 'coresell' && core) {
        closeLots(i, [core], 'core', reason);
        core = null;
      } else if (act === 'dipbuy') {
        const lot = newLot(i);
        if (lot) {
          signals.push({ date: lot.date, side: core || dip.length ? 'add' : 'buy', leg: 'dip', price: lot.price });
          dip.push(lot);
          lastDipBuy = i;
        }
      } else if (act === 'dipsell' && dip.length) {
        closeLots(i, dip, 'dip', reason);
        dip = [];
      }
      peakCost = Math.max(peakCost, exposure());
    }
    pending = [];
    if (i === n - 1) break; // sem sessão seguinte para executar decisões
    if (!canAct || i < startIdx || rsi[i] == null) continue;

    // --- Fecho: decide para a abertura seguinte ---
    const close = bars[i].closeRaw;
    if (o.core > 0 && sma[i] != null) {
      if (!core && C[i] > sma[i] * (1 + o.coreBand)) pending.push({ act: 'corebuy' });
      else if (core && C[i] < sma[i] * (1 - o.coreBand)) pending.push({ act: 'coresell', reason: 'trend' });
    }
    if (dip.length) {
      const avg = sum(dip, (l) => l.cost) / sum(dip, (l) => l.quantity);
      if (rsi[i] > o.rsiOut) { pending.push({ act: 'dipsell', reason: 'rsi' }); continue; }
      if (o.target > 0 && close >= avg * (1 + o.target)) { pending.push({ act: 'dipsell', reason: 'target' }); continue; }
      if (o.disaster > 0 && close < Math.min(...dip.map((l) => l.price)) * (1 - o.disaster)) { pending.push({ act: 'dipsell', reason: 'disaster' }); continue; }
    }
    if (dip.length < o.maxLots && rsi[i] < o.rsiIn && i - lastDipBuy >= o.spacing
      && (!dip.length || close <= dip.at(-1).price * (1 - o.step))) pending.push({ act: 'dipbuy' });
  }

  const lastIdx = n - 1;
  let open = null;
  const lots = [...(core ? [core] : []), ...dip].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (lots.length) {
    const lastPrice = bars[lastIdx].closeRaw;
    const quantity = sum(lots, (l) => l.quantity);
    const cost = round2(sum(lots, (l) => l.cost));
    const value = round2(quantity * lastPrice);
    open = {
      buyDate: lots[0].date, quantity, cost, avgPrice: cost / quantity, lots, reinforcements: lots.length - 1,
      lastDate: bars[lastIdx].date, lastPrice, value, pnl: round2(value - cost), pnlPct: (value / cost - 1) * 100,
      legs: { core: Boolean(core), dip: dip.length },
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

  const realized = round2(sum(trades, (t) => t.pnl));
  const total = round2(realized + (open?.pnl ?? 0));
  return {
    trades, open, signals,
    firstDate: canAct ? bars[startIdx].date : null,
    summary: {
      closed: trades.length,
      wins: trades.filter((t) => t.pnl > 0).length,
      reinforcements: signals.filter((s) => s.side === 'add').length,
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
