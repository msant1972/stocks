/**
 * Portfolio Recomendado — carteira-modelo de 20 instrumentos, revista de duas em duas semanas
 * (docs/arquitectura/Portfolio-Recomendado.md).
 *
 * Em cada revisão ordena o catálogo pela pontuação das Promessas (shared/promessas.js: tendência longa, liquidez e regularidade,
 * só entre os instrumentos com a tendência intacta) e diz o que comprar, manter e vender:
 *  - mantém uma posição enquanto for elegível e estiver entre os `keepRank` melhores (histerese: poupa trocas e custos);
 *  - vende as que deixam de cumprir;
 *  - compra, pela ordem do ranking, até ter `positions` posições, sem passar de `maxPerSector` por sector (diversificação).
 *
 * Revisões: a primeira sessão de cada bloco de `weeks` semanas (blocos contados a partir de uma segunda-feira fixa, para as datas
 * não dependerem da janela). Decisão ao fecho dessa sessão, execução na abertura da sessão seguinte. Sem lookahead.
 *
 * Contabilidade de carteira, em preços ajustados (dividendos incluídos): parte de `capital` euros; o dinheiro de cada venda é
 * repartido em partes iguais pelos lugares vazios; as posições mantidas não são reequilibradas. Custos da SAXO descontados em
 * cada ordem (comissão e meio spread, shared/costs.js) e custódia ao dia. Sem elegíveis suficientes, o resto fica em numerário.
 *
 * Módulo de JavaScript puro, partilhado pelo servidor (rota /recommended-portfolio) e pelos testes.
 */
import { DEFAULT_COSTS, orderCost } from '../costs.js';
import { rollingMean } from '../momentum.js';
import { SESSIONS_NEEDED, WEIGHTS, rank as rankPromessas } from '../promessas.js';
import { m2Series, prepare } from './b-opus.js';

export const DEFAULT_OPTIONS = {
  positions: 20,          // instrumentos na carteira
  keepRank: 40,           // uma posição só sai por ranking se cair para além deste lugar
  weeks: 2,               // semanas entre revisões
  maxPerSector: 5,        // compras novas: no máximo estas posições por sector (0 = sem limite)
  minTradedValue: 1_000_000, // valor negociado médio de 50 sessões mínimo (para a ordem ser executável)
  staleSessions: 5,       // um instrumento sem cotação há mais destas sessões fica fora da revisão
  capital: 300_000,       // capital de referência (20 × 15 000 €); só conta para o mínimo da comissão
};

/** Valida e completa as opções numéricas (chaves desconhecidas e valores inválidos → erro). */
export function resolveOptions(options = {}) {
  for (const [k, v] of Object.entries(options)) {
    if (!(k in DEFAULT_OPTIONS)) throw new Error(`Portfolio: opção desconhecida «${k}»`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`Portfolio: «${k}» deve ser um número não negativo`);
  }
  const o = { ...DEFAULT_OPTIONS, ...options };
  if (o.positions < 1 || !Number.isInteger(o.positions)) throw new Error('Portfolio: «positions» deve ser um inteiro positivo');
  if (o.keepRank < o.positions) throw new Error('Portfolio: «keepRank» não pode ser inferior a «positions»');
  if (o.weeks < 1 || !Number.isInteger(o.weeks)) throw new Error('Portfolio: «weeks» deve ser um inteiro positivo');
  if (!(o.capital > 0)) throw new Error('Portfolio: «capital» deve ser positivo');
  return o;
}

const DAY_MS = 86_400_000;
const round2 = (v) => Math.round(v * 100) / 100;
const dayNumber = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY_MS;
const isoOfDay = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Número do bloco de `weeks` semanas a que a data pertence (semanas de segunda a domingo, contadas desde 29 dez. 1969). */
export function blockOf(date, weeks = DEFAULT_OPTIONS.weeks) {
  return Math.floor(Math.floor((dayNumber(date) + 3) / 7) / weeks);
}

/** Segunda-feira em que começa o bloco seguinte ao da data (a revisão seguinte é na primeira sessão a partir desse dia). */
export function nextBlockStart(date, weeks = DEFAULT_OPTIONS.weeks) {
  return isoOfDay((blockOf(date, weeks) + 1) * weeks * 7 - 3);
}

/** 'AAAA-MM-DD' recuado n meses (dia ajustado ao fim do mês). */
export function monthsBefore(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 - n, d));
  if (t.getUTCDate() !== d) t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
}

/**
 * Prepara um instrumento: séries ajustadas e as médias de que os sinais precisam.
 * meta: { id, symbol, name, sector }; quotes como em daily_quotes, por ordem cronológica.
 */
export function prepareInstrument(meta, quotes) {
  const { bars } = prepare(quotes);
  const C = bars.map((b) => b.C);
  return {
    ...meta,
    dates: bars.map((b) => b.date),
    O: bars.map((b) => b.O),
    C,
    closeRaw: bars.map((b) => b.closeRaw),
    traded: bars.map((b) => b.closeRaw * b.volume),
    s50: rollingMean(C, 50),
    s200: rollingMean(C, 200),
    m2: m2Series(C, 252, 21),
  };
}

/** Índice da última sessão com data ≤ d (busca binária), ou -1. */
export function lastIndexAtOrBefore(dates, d) {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Sinais do instrumento na sessão i, com os mesmos nomes e definições de promessas.features (null sem histórico suficiente). */
export function featuresAt(inst, i) {
  if (i < SESSIONS_NEEDED - 1) return null;
  const { C } = inst;
  let sum = 0;
  let up = 0;
  const rets = [];
  for (let k = i - 62; k <= i; k++) {
    const r = C[k] / C[k - 1] - 1;
    rets.push(r);
    sum += r;
    if (r > 0) up += 1;
  }
  const mean = sum / rets.length;
  const vol63 = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);
  let traded = 0;
  for (let k = i - 49; k <= i; k++) traded += inst.traded[k];
  return {
    date: inst.dates[i],
    close: inst.closeRaw[i],
    m2: inst.m2[i],
    vol63,
    s200slope: inst.s200[i] / inst.s200[i - 63] - 1,
    aboveS200: C[i] > inst.s200[i],
    s50AboveS200: inst.s50[i] > inst.s200[i],
    r63: C[i] / C[i - 63] - 1,
    r252: C[i] / C[i - 252] - 1,
    mom121: C[i - 21] / C[i - 252] - 1,
    s50over200: inst.s50[i] / inst.s200[i] - 1,
    upDays63: up / rets.length,
    liq: traded / 50,
  };
}

/**
 * Ranking do universo à data d: os elegíveis (tendência intacta e liquidez mínima) por pontuação decrescente, cada um com o
 * seu lugar (1 = o melhor). calendarPos: posição de cada data no calendário comum (para excluir instrumentos sem cotação recente).
 */
export function ranking(universe, d, o, calendarPos, weights = WEIGHTS) {
  const items = [];
  for (const inst of universe) {
    const i = lastIndexAtOrBefore(inst.dates, d);
    if (i < 0) continue;
    const gap = calendarPos.get(d) - (calendarPos.get(inst.dates[i]) ?? -Infinity);
    if (!(gap <= o.staleSessions)) continue;
    const features = featuresAt(inst, i);
    if (features) items.push({ inst, symbol: inst.symbol, features });
  }
  const rows = rankPromessas(items, weights).filter((x) => x.eligible && x.features.liq >= o.minTradedValue);
  rows.forEach((r, k) => { r.rank = k + 1; });
  rows.scored = items.length;
  return rows;
}

/**
 * Decisão de uma revisão. rows: o ranking; current: ids das posições abertas. Devolve { keep, sell, buy } (ids; sell com o
 * motivo: 'ranking' ou 'filtro') e byId (a linha do ranking de cada instrumento elegível).
 *
 *  1. Ficam as posições elegíveis entre os `keepRank` melhores.
 *  2. Os lugares livres vão, pela ordem do ranking, para os melhores que caibam no limite por sector: primeiro os que estão entre
 *     os `keepRank` melhores; depois as posições actuais que já saíram desse grupo (ficam, em vez de serem trocadas por outras
 *     que também estão fora dele); só no fim instrumentos novos de fora do grupo.
 * Assim uma posição que saiu dos `keepRank` melhores só é vendida quando há um substituto melhor que cabe no limite por sector,
 * e nunca se vende e volta a comprar o mesmo instrumento na mesma revisão.
 */
export function plan(rows, current, o) {
  const byId = new Map(rows.map((r) => [r.inst.id, r]));
  const held = new Set(current);
  const keep = current.filter((id) => (byId.get(id)?.rank ?? Infinity) <= o.keepRank);
  keep.sort((a, b) => byId.get(a).rank - byId.get(b).rank);
  keep.splice(o.positions);
  const chosen = new Set(keep);
  const perSector = new Map();
  for (const id of keep) { const s = byId.get(id).inst.sector; if (s) perSector.set(s, (perSector.get(s) ?? 0) + 1); }
  const buy = [];
  const take = (candidates, list) => {
    for (const r of candidates) {
      if (chosen.size >= o.positions) return;
      const s = r.inst.sector;
      if (chosen.has(r.inst.id) || (o.maxPerSector > 0 && s && (perSector.get(s) ?? 0) >= o.maxPerSector)) continue;
      if (s) perSector.set(s, (perSector.get(s) ?? 0) + 1);
      chosen.add(r.inst.id);
      list.push(r.inst.id);
    }
  };
  take(rows.filter((r) => r.rank <= o.keepRank && !held.has(r.inst.id)), buy);
  take(rows.filter((r) => r.rank > o.keepRank && held.has(r.inst.id)), keep);
  take(rows.filter((r) => r.rank > o.keepRank && !held.has(r.inst.id)), buy);
  const sell = current.filter((id) => !chosen.has(id)).map((id) => ({ id, reason: byId.has(id) ? 'ranking' : 'filtro' }));
  return { keep, sell, buy, byId };
}

/** Maior queda desde um máximo, em fracção do máximo (valor ≤ 0). */
export function maxDrawdown(values) {
  let peak = -Infinity;
  let worst = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) worst = Math.min(worst, v / peak - 1);
  }
  return worst;
}

/**
 * Simula a carteira. universe: instrumentos preparados (prepareInstrument). start: primeira data da simulação (por omissão, o
 * início do histórico; a carteira começa vazia e convém começar bem antes de `from`, para a janela medir uma carteira já em
 * andamento); from: início da janela do
 * indicador de rendimento; to: última sessão (inclusive). weights: pesos da pontuação (por omissão os das Promessas).
 *
 * Devolve { curve, summary, review, positions, reviews, trades, options, firstDate, lastDate }:
 *  - curve: por sessão da janela, { date, value, benchmark } em base 100 no início da janela (benchmark: todo o catálogo em
 *    partes iguais, comprado no início da janela e mantido, com os mesmos custos);
 *  - review: a última revisão — { date, executed, executionDate, next, buy, keep, sell } com os instrumentos de cada lista;
 *  - positions: a carteira à última sessão (peso, data de entrada, resultado);
 *  - reviews: as revisões da janela, da mais recente para a mais antiga, com o que entrou e saiu;
 *  - trades: posições fechadas na janela.
 */
export function simulate(universe, { start = null, from, to, weights = WEIGHTS, costs = DEFAULT_COSTS, ...options } = {}) {
  const o = resolveOptions(options);
  const all = new Set();
  for (const inst of universe) for (const d of inst.dates) if (d <= to) all.add(d);
  const calendar = [...all].sort();
  const calendarPos = new Map(calendar.map((d, k) => [d, k]));
  const first = start ? calendar.findIndex((d) => d >= start) : 0; // sem `start`, desde o início do histórico
  if (first < 0 || !calendar.some((d) => d >= from)) return emptyResult(o);
  const byId = new Map(universe.map((u) => [u.id, u]));

  const openOf = (inst, d) => { // abertura (ajustada) da primeira sessão do instrumento com data ≥ d
    let k = lastIndexAtOrBefore(inst.dates, d);
    if (k < 0 || inst.dates[k] < d) k += 1;
    return k < inst.dates.length ? { price: inst.O[k], date: inst.dates[k] } : null;
  };
  const closeAt = (inst, d) => inst.C[lastIndexAtOrBefore(inst.dates, d)];
  const label = (inst, r) => ({
    instrumentId: inst.id, symbol: inst.symbol, name: inst.name ?? null, sector: inst.sector ?? null,
    rank: r?.rank ?? null, score: r?.score ?? null,
  });

  let cash = o.capital;
  const positions = new Map(); // id → { inst, units, buyDate, cost }
  const trades = [];
  const reviews = [];
  const values = []; // { date, value, positions }
  let pending = null;
  let last = null; // última revisão (decisão e ranking)
  let feesPaid = 0; // custos pagos dentro da janela do indicador
  const positionsValue = (d) => { let v = 0; for (const p of positions.values()) v += p.units * closeAt(p.inst, d); return v; };

  // Benchmark: todo o catálogo em partes iguais, comprado ao fecho da primeira sessão da janela e mantido.
  const benchFrom = calendar.find((d) => d >= from);
  const bench = [];
  for (const inst of universe) {
    const i = lastIndexAtOrBefore(inst.dates, benchFrom);
    if (i < 0 || calendarPos.get(benchFrom) - (calendarPos.get(inst.dates[i]) ?? -Infinity) > o.staleSessions) continue;
    bench.push({ inst, price: inst.C[i] });
  }
  const benchAlloc = bench.length ? o.capital / bench.length : 0;
  for (const b of bench) b.units = (benchAlloc - orderCost(benchAlloc, costs)) / b.price;
  let benchFees = 0;

  for (let k = first; k < calendar.length; k++) {
    const d = calendar[k];
    const elapsed = k > 0 ? dayNumber(d) - dayNumber(calendar[k - 1]) : 0;
    if (pending) {
      for (const { id, reason } of pending.sell) {
        const p = positions.get(id);
        const px = openOf(p.inst, d);
        if (!px) continue; // sem sessão (instrumento suspenso): fica para a revisão seguinte
        const gross = p.units * px.price;
        const fee = orderCost(gross, costs);
        cash += gross - fee;
        if (d >= from) feesPaid += fee;
        trades.push({
          instrumentId: id, symbol: p.inst.symbol, name: p.inst.name ?? null, buyDate: p.buyDate, sellDate: px.date, reason,
          cost: round2(p.cost), proceeds: round2(gross - fee), pnl: round2(gross - fee - p.cost), pnlPct: ((gross - fee) / p.cost - 1) * 100,
        });
        positions.delete(id);
      }
      const slots = o.positions - positions.size;
      const buys = pending.buy.slice(0, Math.max(0, slots));
      const alloc = slots > 0 ? Math.max(0, cash) / slots : 0;
      for (const id of buys) {
        const inst = byId.get(id);
        const px = openOf(inst, d);
        if (!px || !(alloc > 0)) continue;
        const fee = orderCost(alloc, costs);
        positions.set(id, { inst, units: (alloc - fee) / px.price, buyDate: px.date, cost: alloc });
        cash -= alloc;
        if (d >= from) feesPaid += fee;
      }
      if (last && last.date === pending.date) { last.executed = true; last.executionDate = d; }
      pending = null;
    }
    // Custódia: ao dia, sobre o valor das posições.
    const held = positionsValue(d);
    const custody = (held * costs.custodyPctYear * elapsed) / 100 / 365;
    cash -= custody;
    if (d >= from) feesPaid += custody;
    values.push({ date: d, value: cash + held, positions: positions.size });

    // Revisão: a primeira sessão de um bloco novo (decide ao fecho, executa na abertura seguinte).
    if (k > 0 && blockOf(d, o.weeks) !== blockOf(calendar[k - 1], o.weeks)) {
      const rows = ranking(universe, d, o, calendarPos, weights);
      const decision = plan(rows, [...positions.keys()], o);
      pending = { date: d, sell: decision.sell, buy: decision.buy };
      last = { date: d, executed: false, executionDate: null, rows, decision, eligible: rows.length, scored: rows.scored };
      reviews.push({
        date: d, eligible: rows.length,
        bought: decision.buy.map((id) => byId.get(id).symbol), sold: decision.sell.map((s) => byId.get(s.id).symbol), kept: decision.keep.length,
      });
    }
    if (d >= benchFrom) {
      let v = 0;
      for (const b of bench) v += b.units * closeAt(b.inst, d);
      if (d > benchFrom) benchFees += (v * costs.custodyPctYear * elapsed) / 100 / 365;
      values.at(-1).benchmark = v - benchFees;
    }
  }

  const lastDate = calendar.at(-1);
  const window = values.filter((v) => v.date >= from);
  const base = window[0];
  const curve = window.map((v) => ({
    date: v.date, value: (v.value / base.value) * 100, benchmark: base.benchmark ? (v.benchmark / base.benchmark) * 100 : null, positions: v.positions,
  }));
  const total = values.at(-1).value;
  const held = positionsValue(lastDate);

  const positionRow = (p) => {
    const value = p.units * closeAt(p.inst, lastDate);
    const r = last?.decision.byId.get(p.inst.id);
    return {
      ...label(p.inst, r), buyDate: p.buyDate, weight: value / total, pnlPct: (value / p.cost - 1) * 100,
      close: p.inst.closeRaw[lastIndexAtOrBefore(p.inst.dates, lastDate)],
    };
  };
  const open = [...positions.values()].map(positionRow).sort((a, b) => b.weight - a.weight);
  const openById = new Map(open.map((p) => [p.instrumentId, p]));

  // As três listas da última revisão. Se já foi executada, as compras já são posições e as vendas já são operações fechadas.
  let review = { date: null, executed: false, executionDate: null, next: null, eligible: 0, buy: [], keep: [], sell: [] };
  if (last) {
    const { decision } = last;
    const closeNow = (inst) => inst.closeRaw[lastIndexAtOrBefore(inst.dates, lastDate)];
    const target = 1 / o.positions;
    review = {
      date: last.date, executed: last.executed, executionDate: last.executionDate, next: nextBlockStart(last.date, o.weeks), eligible: last.eligible,
      buy: decision.buy.map((id) => {
        const inst = byId.get(id);
        const p = openById.get(id);
        return { ...label(inst, decision.byId.get(id)), close: closeNow(inst), weight: p?.weight ?? target, buyDate: p?.buyDate ?? null, pnlPct: p?.pnlPct ?? null };
      }),
      keep: decision.keep.map((id) => openById.get(id)).filter(Boolean),
      sell: decision.sell.map(({ id, reason }) => {
        const inst = byId.get(id);
        const p = openById.get(id); // ainda aberta se a revisão não foi executada
        const t = p ? null : trades.findLast((x) => x.instrumentId === id);
        return {
          ...label(inst, decision.byId.get(id)), reason, close: closeNow(inst),
          buyDate: p?.buyDate ?? t?.buyDate ?? null, sellDate: t?.sellDate ?? null, pnlPct: p?.pnlPct ?? t?.pnlPct ?? null,
        };
      }),
    };
  }

  const valueAt = (date) => window.find((v) => v.date >= date) ?? null;
  const since = (months) => {
    const v = valueAt(monthsBefore(lastDate, months));
    return v && v.date > base.date ? { value: (total / v.value - 1) * 100, benchmark: v.benchmark ? (values.at(-1).benchmark / v.benchmark - 1) * 100 : null } : null;
  };
  const closedInWindow = trades.filter((t) => t.sellDate >= from);
  const reviewsInWindow = reviews.filter((r) => r.date >= from);
  const years = Math.max((dayNumber(lastDate) - dayNumber(base.date)) / 365.25, 1 / 365.25);
  const ret = total / base.value - 1;
  const benchRet = base.benchmark ? values.at(-1).benchmark / base.benchmark - 1 : null;

  return {
    options: o, firstDate: base.date, lastDate, curve,
    summary: {
      returnPct: ret * 100, benchmarkPct: benchRet == null ? null : benchRet * 100,
      annualPct: ((1 + ret) ** (1 / years) - 1) * 100,
      last12: since(12), last6: since(6), last3: since(3),
      maxDrawdownPct: maxDrawdown(window.map((v) => v.value)) * 100,
      benchmarkDrawdownPct: base.benchmark ? maxDrawdown(window.map((v) => v.benchmark)) * 100 : null,
      reviews: reviewsInWindow.length, closed: closedInWindow.length, wins: closedInWindow.filter((t) => t.pnl > 0).length,
      tradesPerReview: reviewsInWindow.length ? reviewsInWindow.reduce((s, r) => s + r.bought.length, 0) / reviewsInWindow.length : 0,
      avgPositions: window.reduce((s, v) => s + v.positions, 0) / window.length,
      invested: total > 0 ? held / total : 0, benchmarkInstruments: bench.length, feesPct: (feesPaid / base.value) * 100,
    },
    review, positions: open,
    reviews: reviewsInWindow.reverse(),
    trades: closedInWindow.sort((a, b) => b.sellDate.localeCompare(a.sellDate)),
  };
}

function emptyResult(o) {
  return {
    options: o, firstDate: null, lastDate: null, curve: [],
    summary: {
      returnPct: 0, benchmarkPct: null, annualPct: 0, last12: null, last6: null, last3: null, maxDrawdownPct: 0, benchmarkDrawdownPct: null,
      reviews: 0, closed: 0, wins: 0, tradesPerReview: 0, avgPositions: 0, invested: 0, benchmarkInstruments: 0, feesPct: 0,
    },
    review: { date: null, executed: false, executionDate: null, next: null, eligible: 0, buy: [], keep: [], sell: [] },
    positions: [], reviews: [], trades: [],
  };
}
