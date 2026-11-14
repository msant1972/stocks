/**
 * Rotação por momentum relativo — estratégia de CARTEIRA (docs/arquitectura/Rotacao.md).
 *
 * Ao contrário das outras estratégias do registo, que decidem instrumento a instrumento, esta compara os instrumentos entre si:
 * no último dia útil de cada mês ordena o universo pelo momentum de 12 meses sem o último mês (Jegadeesh e Titman: retorno de
 * t−252 a t−21) e mantém os N melhores (por omissão 10), com um lote igual por posição. É a anomalia de momentum transversal,
 * a mais documentada da literatura, e resolve o problema do capital finito: só há N posições, escolhidas pelo mérito relativo.
 *
 * Regras (todas sobre o fecho ajustado, decididas ao fecho do último dia útil do mês e executadas na abertura da sessão seguinte,
 * a preços reais; sem lookahead):
 *  - elegível: momentum 12-1 positivo (momentum absoluto), fecho acima da SMA200 (tendência) e valor negociado médio de 50
 *    sessões de pelo menos 5 M€ (liquidez);
 *  - mantém uma posição enquanto for elegível e estiver entre os `keepRank` melhores (histerese: poupa rotação e custos);
 *    vende as que deixam de cumprir; compra, pela ordem do ranking, até ter N posições;
 *  - sem stops intra-mês; lotes de 15 000 €, quantidades inteiras; sem comissões (os custos estimados vêm de shared/costs.js).
 *
 * Módulo de JavaScript puro, partilhado pelo servidor (rota /strategies/rotation) e pelos testes.
 */
import { strategyCosts, buyHoldCosts } from '../costs.js';

export const DEFAULT_OPTIONS = {
  budget: 15000,
  positions: 10,        // posições em simultâneo
  keepRank: 20,         // uma posição só sai por ranking se cair para além deste lugar
  lookback: 252,        // sessões do momentum (12 meses)
  skip: 21,             // sessões ignoradas no fim (1 mês)
  smaTrend: 200,        // média de tendência
  minTradedValue: 5_000_000,
  tradedWindow: 50,
  staleSessions: 5,     // um instrumento sem cotação há mais destas sessões antes da revisão fica de fora
  // Filtro de regime de mercado (dual momentum): amplitude = parte dos instrumentos acima da SMA200 na data da revisão.
  regime: 0,            // 0 desligado; 1 sem compras novas com a amplitude abaixo de regimeMin; 2 também vende tudo (fica em numerário)
  regimeMin: 0.5,
  // Dimensionamento: 0 lotes iguais; 1 pela volatilidade (lote × volatilidade mediana / volatilidade do instrumento, entre ½ e 2 lotes).
  sizing: 0,
  volWindow: 60,
};

/** Valida e completa as opções (chaves desconhecidas e valores inválidos → erro). */
export function resolveOptions(options = {}) {
  for (const [k, v] of Object.entries(options)) {
    if (!(k in DEFAULT_OPTIONS)) throw new Error(`Rotação: opção desconhecida «${k}»`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`Rotação: «${k}» deve ser um número não negativo`);
  }
  const o = { ...DEFAULT_OPTIONS, ...options };
  if (o.positions < 1 || !Number.isInteger(o.positions)) throw new Error('Rotação: «positions» deve ser um inteiro positivo');
  if (o.keepRank < o.positions) throw new Error('Rotação: «keepRank» não pode ser inferior a «positions»');
  return o;
}

const round2 = (v) => Math.round(v * 100) / 100;

/** Médias móveis simples de uma série (null antes de haver n valores). */
function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/**
 * Prepara um instrumento: série ajustada, SMA200 e valor negociado médio, e a pesquisa «última sessão até à data».
 * quotes: { date, open, close, adjClose, volume } por ordem cronológica (valores numéricos; adjClose pode faltar).
 */
export function prepareInstrument(meta, quotes, o) {
  const dates = [];
  const open = [];
  const close = [];
  const adj = [];
  const traded = [];
  const rets = [];
  for (const q of quotes) {
    const c = Number(q.close);
    const op = Number(q.open);
    if (!(c > 0) || !(op > 0)) continue;
    dates.push(q.date);
    open.push(op);
    close.push(c);
    adj.push(Number(q.adjClose ?? q.close) > 0 ? Number(q.adjClose ?? q.close) : c);
    traded.push(c * (Number(q.volume) || 0));
    rets.push(adj.length > 1 ? adj.at(-1) / adj.at(-2) - 1 : 0);
  }
  const vol = rets.map((_, i) => {
    if (i < o.volWindow) return null;
    let m = 0;
    for (let k = i - o.volWindow + 1; k <= i; k++) m += rets[k];
    m /= o.volWindow;
    let ss = 0;
    for (let k = i - o.volWindow + 1; k <= i; k++) ss += (rets[k] - m) ** 2;
    return Math.sqrt(ss / (o.volWindow - 1));
  });
  const index = new Map(dates.map((d, i) => [d, i]));
  return { ...meta, dates, open, close, adj, vol, sma: sma(adj, o.smaTrend), traded: sma(traded, o.tradedWindow), index };
}

/** Índice da última sessão com data ≤ d (busca binária), ou -1. */
function lastIndexAtOrBefore(dates, d) {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Pontuação de um instrumento à data d: { i, momentum, eligible }, ou null sem dados suficientes. */
export function score(inst, d, o, calendarPos) {
  const i = lastIndexAtOrBefore(inst.dates, d);
  if (i < o.lookback || inst.sma[i] == null) return null;
  // Sem cotação recente (instrumento suspenso ou com falhas): fora do ranking.
  const gap = calendarPos.get(d) - (calendarPos.get(inst.dates[i]) ?? -Infinity);
  if (!(gap <= o.staleSessions)) return null;
  const momentum = inst.adj[i - o.skip] / inst.adj[i - o.lookback] - 1;
  const eligible = momentum > 0 && inst.adj[i] > inst.sma[i] && (inst.traded[i] ?? 0) >= o.minTradedValue;
  return { i, momentum, eligible, above: inst.adj[i] > inst.sma[i] };
}

/** Ranking do universo à data d: elegíveis por momentum decrescente, cada um com o seu lugar (1 = o melhor). */
export function rank(universe, d, o, calendarPos) {
  const rows = [];
  let scored = 0;
  let above = 0;
  for (const inst of universe) {
    const s = score(inst, d, o, calendarPos);
    if (!s) continue;
    scored += 1;
    if (s.above) above += 1;
    if (s.eligible) rows.push({ inst, momentum: s.momentum, close: inst.close[s.i], vol: inst.vol[s.i] });
  }
  rows.sort((a, b) => b.momentum - a.momentum || a.inst.symbol.localeCompare(b.inst.symbol));
  rows.forEach((r, k) => { r.rank = k + 1; });
  // Amplitude do mercado e volatilidade mediana dos elegíveis, para o filtro de regime e o dimensionamento.
  rows.breadth = scored ? above / scored : null;
  const vols = rows.map((r) => r.vol).filter((v) => v > 0).sort((a, b) => a - b);
  rows.volRef = vols.length ? vols[vols.length >> 1] : null;
  return rows;
}

/**
 * Posições a manter e a abrir numa revisão: mantém as actuais que continuam elegíveis e dentro de `keepRank`; enche com os
 * melhores do ranking até `positions`. current: ids das posições abertas. Devolve { keep, sell, buy } (ids) e o ranking.
 */
export function plan(universe, d, current, o, calendarPos) {
  const ranking = rank(universe, d, o, calendarPos);
  const byId = new Map(ranking.map((r) => [r.inst.id, r]));
  const keep = current.filter((id) => (byId.get(id)?.rank ?? Infinity) <= o.keepRank);
  // Se, mesmo mantendo, houver mais do que `positions` (parâmetros alterados), ficam as melhores.
  keep.sort((a, b) => byId.get(a).rank - byId.get(b).rank);
  keep.splice(o.positions);
  const kept = new Set(keep);
  const sell = current.filter((id) => !kept.has(id));
  const buy = [];
  for (const r of ranking) {
    if (keep.length + buy.length >= o.positions) break;
    if (!kept.has(r.inst.id)) buy.push(r.inst.id);
  }
  // Tamanho do lote de cada compra: 1 (lotes iguais) ou, com sizing 1, inversamente proporcional à volatilidade (entre ½ e 2 lotes).
  const scale = new Map();
  for (const id of buy) {
    const r = byId.get(id);
    scale.set(id, o.sizing === 1 && r.vol > 0 && ranking.volRef ? Math.min(2, Math.max(0.5, ranking.volRef / r.vol)) : 1);
  }
  // Filtro de regime: com a amplitude do mercado abaixo do mínimo, não se compra; no modo 2 vende-se tudo (numerário).
  const bear = o.regime > 0 && ranking.breadth != null && ranking.breadth < o.regimeMin;
  if (bear) {
    buy.length = 0;
    if (o.regime === 2) { sell.splice(0, sell.length, ...current); keep.length = 0; }
  }
  return { keep, sell, buy, scale, ranking, breadth: ranking.breadth, bear };
}

const monthOf = (d) => d.slice(0, 7);

/**
 * Simula a rotação. universe: instrumentos preparados (prepareInstrument); from/to: janela (AAAA-MM-DD, `to` inclusivo).
 * Devolve { trades, open, summary, curve, rebalances, next, options }: trades no formato comum do registo (um por posição, com
 * lots, pnl e pnlPct), `open` as posições abertas, `curve` o resultado acumulado por sessão, `next` a revisão que se faria com os
 * últimos dados (ranking e decisões) e `summary` o resumo com os custos estimados e a comparação com comprar e manter.
 */
export function simulate(universe, { from, to, ...options } = {}) {
  const o = resolveOptions(options);
  // Calendário comum: união das datas das sessões da janela.
  const all = new Set();
  for (const inst of universe) for (const d of inst.dates) if (d <= to) all.add(d);
  const calendar = [...all].sort();
  const calendarPos = new Map(calendar.map((d, k) => [d, k]));
  const window = calendar.filter((d) => d >= from);
  if (window.length < 2) return emptyResult(o);

  // Revisões: o último dia útil de cada mês da janela (decisão ao fecho; execução na abertura seguinte).
  const reviews = new Set();
  for (let k = 0; k < window.length - 1; k++) if (monthOf(window[k]) !== monthOf(window[k + 1])) reviews.add(window[k]);

  const trades = [];
  const rebalances = [];
  let positions = new Map(); // id → { inst, buyDate, quantity, cost, lots }
  let realized = 0;
  let peakCost = 0;
  const curve = [];
  let pending = null; // { sell: [ids], buy: [ids] } decidido na revisão anterior

  const openOf = (inst, d) => { // abertura da primeira sessão do instrumento com data ≥ d
    let k = lastIndexAtOrBefore(inst.dates, d);
    if (k < 0 || inst.dates[k] < d) k += 1;
    return k < inst.dates.length ? { price: inst.open[k], date: inst.dates[k] } : null;
  };

  for (const d of window) {
    if (pending) {
      for (const id of pending.sell) {
        const p = positions.get(id);
        const px = openOf(p.inst, d);
        if (!px) continue; // sem sessão (instrumento suspenso): fica para a revisão seguinte
        const proceeds = round2(p.quantity * px.price);
        trades.push({
          instrumentId: id, symbol: p.inst.symbol, name: p.inst.name ?? null,
          buyDate: p.buyDate, sellDate: px.date, quantity: p.quantity, cost: p.cost, avgPrice: p.cost / p.quantity,
          lots: p.lots, reinforcements: 0, sellPrice: px.price, proceeds, reason: 'rotation',
          pnl: round2(proceeds - p.cost), pnlPct: (proceeds / p.cost - 1) * 100,
        });
        realized += proceeds - p.cost;
        positions.delete(id);
      }
      for (const id of pending.buy) {
        const inst = universe.find((u) => u.id === id);
        const px = openOf(inst, d);
        const quantity = px ? Math.floor((o.budget * (pending.scale?.get(id) ?? 1)) / px.price) : 0;
        if (quantity < 1) continue;
        const lot = { date: px.date, price: px.price, quantity, cost: round2(quantity * px.price) };
        positions.set(id, { inst, buyDate: px.date, quantity, cost: lot.cost, lots: [lot] });
      }
      peakCost = Math.max(peakCost, round2([...positions.values()].reduce((s, p) => s + p.cost, 0)));
      pending = null;
    }
    // Resultado acumulado ao fecho: realizado + posições abertas ao último fecho conhecido.
    let unreal = 0;
    for (const p of positions.values()) {
      const k = lastIndexAtOrBefore(p.inst.dates, d);
      unreal += p.quantity * p.inst.close[k] - p.cost;
    }
    curve.push({ date: d, pnl: round2(realized + unreal), positions: positions.size });

    if (reviews.has(d)) {
      const decision = plan(universe, d, [...positions.keys()], o, calendarPos);
      rebalances.push({ date: d, sell: decision.sell.length, buy: decision.buy.length, keep: decision.keep.length, breadth: decision.breadth });
      pending = { sell: decision.sell, buy: decision.buy, scale: decision.scale };
      rebalances[rebalances.length - 1].bear = decision.bear;
    }
  }

  const lastDate = window.at(-1);
  const open = [...positions.values()].map((p) => {
    const k = lastIndexAtOrBefore(p.inst.dates, lastDate);
    const lastPrice = p.inst.close[k];
    const value = round2(p.quantity * lastPrice);
    return {
      instrumentId: p.inst.id, symbol: p.inst.symbol, name: p.inst.name ?? null,
      buyDate: p.buyDate, quantity: p.quantity, cost: p.cost, avgPrice: p.cost / p.quantity, lots: p.lots, reinforcements: 0,
      lastDate: p.inst.dates[k], lastPrice, value, pnl: round2(value - p.cost), pnlPct: (value / p.cost - 1) * 100,
    };
  }).sort((a, b) => b.pnl - a.pnl);

  // Custos estimados, no mesmo modelo das outras estratégias (por operação; a posição aberta conta como vendida ao último preço).
  const midIdx = Math.floor(window.length / 2);
  const mid = window[midIdx];
  let costTotal = 0;
  let firstYear = 0;
  let secondYear = 0;
  let winsNet = 0;
  for (const t of trades) {
    const c = strategyCosts({ trades: [t], open: null }, { mid, lastDate }).total;
    costTotal += c;
    if (t.sellDate < mid) firstYear += c; else secondYear += c;
    if (t.pnl - c > 0) winsNet += 1;
  }
  for (const p of open) costTotal += strategyCosts({ trades: [], open: p }, { mid, lastDate }).total;
  const unrealized = round2(open.reduce((s, p) => s + p.pnl, 0));
  const realizedTotal = round2(trades.reduce((s, t) => s + t.pnl, 0));
  const total = round2(realizedTotal + unrealized);

  // Comparação: comprar e manter, em partes iguais, todos os instrumentos com cotação na primeira sessão da janela.
  let bhCost = 0;
  let bhValue = 0;
  let bhN = 0;
  let bhFees = 0;
  for (const inst of universe) {
    const px = openOf(inst, window[0]);
    if (!px || px.date > window[2]) continue;
    const qty = Math.floor(o.budget / px.price);
    const k = lastIndexAtOrBefore(inst.dates, lastDate);
    if (qty < 1 || k < 0) continue;
    const cost = round2(qty * px.price);
    const value = round2(qty * inst.close[k]);
    bhCost += cost; bhValue += value; bhN += 1;
    bhFees += buyHoldCosts({ cost, value, startDate: px.date }, lastDate) ?? 0;
  }
  const dd = maxDrawdown(curve.map((c) => c.pnl));

  return {
    trades, open, curve, rebalances, options: o, firstDate: window[0], lastDate,
    summary: {
      closed: trades.length, wins: trades.filter((t) => t.pnl > 0).length, winsNet,
      peakCost: round2(peakCost), realized: realizedTotal, unrealized, total,
      totalPct: peakCost > 0 ? (total / peakCost) * 100 : 0,
      costs: round2(costTotal), costsFirstYear: round2(firstYear), costsSecondYear: round2(secondYear),
      net: round2(total - costTotal), netPct: peakCost > 0 ? ((total - costTotal) / peakCost) * 100 : 0,
      maxDrawdown: round2(dd), maxDrawdownPct: peakCost > 0 ? (dd / peakCost) * 100 : 0,
      rebalances: rebalances.length, bearReviews: rebalances.filter((x) => x.bear).length, avgPositions: round2(curve.reduce((s, c) => s + c.positions, 0) / curve.length),
      buyHold: bhN ? {
        instruments: bhN, cost: round2(bhCost), value: round2(bhValue), pnl: round2(bhValue - bhCost),
        pnlPct: (bhValue / bhCost - 1) * 100, net: round2(bhValue - bhCost - bhFees), netPct: ((bhValue - bhCost - bhFees) / bhCost) * 100,
      } : null,
    },
    next: nextReview(universe, calendar, calendarPos, [...positions.keys()], o),
  };
}

/** Maior queda do resultado acumulado, desde um máximo (valor ≤ 0, em euros). */
export function maxDrawdown(values) {
  let peak = 0;
  let worst = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    worst = Math.min(worst, v - peak);
  }
  return worst;
}

/** A revisão que se faria com os últimos dados: ranking dos melhores e o que se compraria, manteria e venderia. */
function nextReview(universe, calendar, calendarPos, current, o) {
  const d = calendar.at(-1);
  const decision = plan(universe, d, current, o, calendarPos);
  const label = (r) => ({ instrumentId: r.inst.id, symbol: r.inst.symbol, name: r.inst.name ?? null, rank: r.rank, momentum: r.momentum, close: r.close });
  const byId = new Map(decision.ranking.map((r) => [r.inst.id, r]));
  const top = decision.ranking.slice(0, Math.max(o.positions, o.keepRank)).map(label);
  const sellInfo = decision.sell.map((id) => {
    const inst = universe.find((u) => u.id === id);
    const r = byId.get(id);
    return { instrumentId: id, symbol: inst.symbol, name: inst.name ?? null, rank: r?.rank ?? null, momentum: r?.momentum ?? null, reason: r ? 'ranking' : 'filtro' };
  });
  return {
    date: d, eligible: decision.ranking.length, breadth: decision.breadth, bear: decision.bear,
    keep: decision.keep.map((id) => label(byId.get(id))), buy: decision.buy.map((id) => label(byId.get(id))), sell: sellInfo, top,
  };
}

function emptyResult(o) {
  return {
    trades: [], open: [], curve: [], rebalances: [], options: o, firstDate: null, lastDate: null,
    summary: {
      closed: 0, wins: 0, winsNet: 0, peakCost: 0, realized: 0, unrealized: 0, total: 0, totalPct: 0, costs: 0, costsFirstYear: 0, costsSecondYear: 0,
      net: 0, netPct: 0, maxDrawdown: 0, maxDrawdownPct: 0, rebalances: 0, avgPositions: 0, buyHold: null,
    },
    next: { date: null, eligible: 0, breadth: null, bear: false, keep: [], buy: [], sell: [], top: [] },
  };
}
