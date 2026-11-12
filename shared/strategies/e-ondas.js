/**
 * E-Ondas — comprar o fim das correcções e vender o fim das subidas, por instrumento (docs/arquitectura/E-Ondas.md).
 *
 * Numa acção em tendência de subida (SMA200 a subir), acompanha o fecho mais baixo desde a última venda e compra quando o
 * fecho sobe UP (5 %) acima dele, se esse mínimo foi uma correcção (≥ MIN_DIP, 3 %, abaixo do máximo de 20 sessões) que
 * chegou perto da SMA200 (no máximo NEAR_200, 3 %, acima dela). Com posição, acompanha o fecho mais alto desde a compra e
 * vende tudo quando o fecho cai DOWN (4 %) abaixo dele, depois de o máximo ter chegado a MIN_GAIN (4 %) sobre a compra.
 * Sem reforços nem stop; 15 000 € por compra; sem comissões (os custos estimados são calculados à parte, shared/costs.js).
 *
 * Decide sobre o fecho ajustado (série de prepare, de b-opus.js) e executa ao fecho REAL da mesma sessão, como a A-Momentum.
 * Sem lookahead: a decisão no fecho de t usa só dados até t. Um fundo ou topo só se reconhece depois de o preço se afastar
 * dele: compra-se cerca de 5 % acima do fundo e vende-se cerca de 4 % abaixo do topo.
 */
import { rollingMean } from '../momentum.js';
import { prepare } from './b-opus.js';

export const DEFAULT_OPTIONS = {
  budget: 15000,
  up: 0.05,        // subida desde o mínimo que confirma o fundo
  down: 0.04,      // queda desde o máximo que confirma o topo
  minGain: 0.04,   // ganho mínimo do máximo sobre a compra antes de poder vender
  minDip: 0.03,    // correcção mínima no dia do mínimo (face ao máximo de 20 sessões)
  near200: 0.03,   // distância máxima à SMA200 no dia do mínimo
  slopeN: 20,      // sessões da inclinação da SMA200
  smaTrend: 200,   // período da média de tendência
  dipN: 20,        // sessões do máximo da correcção
};

/** Valida e completa as opções (chaves desconhecidas e valores inválidos → erro). */
export function resolveOptions(options = {}) {
  const { from, ...rest } = options;
  for (const [k, v] of Object.entries(rest)) {
    if (!(k in DEFAULT_OPTIONS)) throw new Error(`E-Ondas: opção desconhecida «${k}»`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`E-Ondas: «${k}» deve ser um número não negativo`);
  }
  if (from != null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('E-Ondas: «from» deve ser AAAA-MM-DD');
  return { ...DEFAULT_OPTIONS, ...rest, from: from ?? null };
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Simula a E-Ondas num instrumento. quotes: sessões em ordem cronológica com date, open, high, low, close (brutos),
 * adjClose e volume. options.from: primeira data em que a estratégia pode comprar (os indicadores usam todo o histórico
 * recebido). Devolve o formato comum do registo de estratégias.
 */
export function backtest(quotes, options = {}) {
  const o = resolveOptions(options);
  const { bars, dataQuality } = prepare(quotes);
  const C = bars.map((b) => b.C);
  const n = C.length;
  const sma = rollingMean(C, o.smaTrend);

  // Primeira sessão com tudo o que as regras precisam: SMA200 de hoje e de há slopeN sessões.
  const warm = o.smaTrend - 1 + o.slopeN;
  const fromPos = o.from ? bars.findIndex((b) => b.date >= o.from) : 0;
  const startIdx = fromPos < 0 || n === 0 ? -1 : Math.max(warm, fromPos);
  const canAct = startIdx >= 0 && startIdx < n;

  const slope = (i) => (sma[i] != null && sma[i - o.slopeN] != null ? sma[i] / sma[i - o.slopeN] - 1 : null);
  const dist200 = (i) => C[i] / sma[i] - 1;
  const dip = (i) => C[i] / Math.max(...C.slice(Math.max(0, i - o.dipN + 1), i + 1)) - 1;

  const trades = [];
  const signals = [];
  let peakCost = 0;
  let pos = null;     // posição aberta
  let low = null;     // fecho ajustado mais baixo desde a última venda (procura de compra)
  let lowIdx = -1;
  let high = null;    // fecho ajustado mais alto desde a compra (procura de venda)

  for (let i = canAct ? startIdx : n; i < n; i++) {
    const b = bars[i];
    const c = C[i];
    const price = b.closeRaw;

    if (!pos) {
      if (low == null || c < low) { low = c; lowIdx = i; }
      if (c < low * (1 + o.up)) continue;
      const quantity = Math.floor(o.budget / price);
      const setup = slope(i) > 0 && dip(lowIdx) <= -o.minDip && dist200(lowIdx) <= o.near200;
      if (setup && quantity >= 1) {
        const lot = { date: b.date, price, quantity, cost: round2(quantity * price) };
        pos = { buyDate: b.date, adj: c, quantity, cost: lot.cost, lots: [lot] };
        peakCost = Math.max(peakCost, lot.cost);
        high = c;
        signals.push({ date: b.date, side: 'buy', price });
      } else {
        low = c; lowIdx = i; // fundo antigo esquecido: a procura recomeça daqui
      }
      continue;
    }

    high = Math.max(high, c);
    if (c <= high * (1 - o.down) && high >= pos.adj * (1 + o.minGain)) {
      const proceeds = round2(pos.quantity * price);
      trades.push({
        buyDate: pos.buyDate, sellDate: b.date, quantity: pos.quantity, cost: pos.cost,
        avgPrice: pos.cost / pos.quantity, lots: pos.lots, reinforcements: 0,
        sellPrice: price, proceeds, reason: 'reversal',
        pnl: round2(proceeds - pos.cost), pnlPct: (proceeds / pos.cost - 1) * 100,
      });
      signals.push({ date: b.date, side: 'sell', reason: 'reversal', price });
      pos = null;
      low = c; lowIdx = i; // o fecho da venda é o ponto de partida da compra seguinte
    }
  }

  const lastIdx = n - 1;
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
    dataQuality,
    options: o,
  };
}
