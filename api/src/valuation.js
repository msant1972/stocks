/**
 * Valorização indicativa de uma empresa (secção «Valorização» do painel Empresa, no Charts).
 *
 * Compara o preço do último fecho com quatro referências, cada uma com um veredicto próprio («barato», «em linha»,
 * «caro» ou sem dados), e um quinto cálculo só informativo (DCF invertido):
 *   1. múltiplos face ao sector (percentil entre as empresas do mesmo sector com perfil);
 *   2. P/E face à própria história (P/E diário com o último resultado anual por acção conhecido);
 *   3. preço-alvo médio dos analistas;
 *   4. número de Graham (√(22,5 × resultado por acção × valor contabilístico por acção)).
 *
 * Os dados da empresa são recolhidos uma vez por semana; o preço muda todos os dias. Para os rácios do Yahoo
 * acompanharem o fecho do dia são reescalados por fecho / preço de referência (o preço do Yahoo na recolha). Isto
 * também evita converter moedas quando as contas estão numa moeda diferente da cotação.
 * Tudo é indicativo e não é uma recomendação de investimento.
 */

export const THRESHOLDS = Object.freeze({
  sectorCheap: 0.67, sectorExpensive: 0.33, minPeers: 5,
  historyMinPoints: 250, analystsMin: 3, analystsCheap: 0.15, analystsExpensive: 0,
  grahamCheap: 0.85, grahamExpensive: 1.15,
  dcfDiscount: 0.09, dcfTerminal: 0.02, dcfYears: 10,
});

const FINANCIAL_SECTORS = new Set(['Financial Services']);

const n = (v) => {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const pos = (v) => (v != null && v > 0 ? v : null);

/** As contas estão na moeda da cotação? (Só então se podem dividir valores das contas pelo preço.) */
export function sameCurrency(row) {
  return !row.financial_currency || !row.currency || row.financial_currency === row.currency;
}

/**
 * Rácios actuais ao fecho `close`: P/E, preço/valor contabilístico, valor da empresa/EBITDA, rendimento do dividendo e
 * do fluxo de caixa livre (em %). Null quando não fazem sentido (prejuízo, capitais próprios negativos, bancos…).
 */
export function currentMetrics(row, close) {
  const c = pos(n(close));
  const ref = pos(n(row.ref_price));
  const k = c && ref ? c / ref : 1;
  const financial = FINANCIAL_SECTORS.has(row.sector);
  const pe = pos(n(row.trailing_pe));
  const pb = pos(n(row.price_to_book));
  const ev = pos(n(row.enterprise_value));
  const evEbitda = pos(n(row.enterprise_to_ebitda));
  const mcap = pos(n(row.market_cap));
  const dy = n(row.dividend_yield);
  const fcf = n(row.free_cashflow);
  const evToday = ev && mcap ? ev + mcap * (k - 1) : null;
  return {
    pe: pe ? pe * k : null,
    pb: pb ? pb * k : null,
    evEbitda: !financial && evEbitda && evToday > 0 ? evEbitda * (evToday / ev) : null,
    dividendYield: dy != null && dy >= 0 ? dy / k : null,
    fcfYield: !financial && fcf != null && mcap && sameCurrency(row) ? (fcf / (mcap * k)) * 100 : null,
  };
}

export const SECTOR_METRICS = [
  { key: 'pe', label: 'P/E', cheapWhen: 'low' },
  { key: 'pb', label: 'Preço / valor contabilístico', cheapWhen: 'low' },
  { key: 'evEbitda', label: 'Valor da empresa / EBITDA', cheapWhen: 'low' },
  { key: 'dividendYield', label: 'Dividendo (rendimento)', cheapWhen: 'high' },
  { key: 'fcfYield', label: 'Fluxo de caixa livre (rendimento)', cheapWhen: 'high' },
];

const quantile = (sorted, q) => {
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/**
 * Posição de `value` entre os pares: fracção (0 a 1) dos pares mais caros do que esta empresa (1 = a mais barata).
 * Empates contam metade.
 */
export function cheapness(value, peerValues, cheapWhen) {
  if (value == null || peerValues.length === 0) return null;
  let worse = 0;
  for (const p of peerValues) {
    if (p === value) worse += 0.5;
    else if (cheapWhen === 'low' ? p > value : p < value) worse += 1;
  }
  return worse / peerValues.length;
}

/** Veredicto a partir de uma pontuação de «barateza» (0 = caro, 1 = barato). */
const byScore = (score, cheapAt, expensiveAt) => (score == null ? null : score >= cheapAt ? 'cheap' : score <= expensiveAt ? 'expensive' : 'fair');

/** 1. Múltiplos face ao sector. `peers` = [{ row, close }] (sem a própria empresa). */
export function sectorComparison(row, close, peers) {
  const mine = currentMetrics(row, close);
  const peerMetrics = peers.map((p) => currentMetrics(p.row, p.close));
  const metrics = [];
  for (const m of SECTOR_METRICS) {
    const values = peerMetrics.map((x) => x[m.key]).filter((v) => v != null);
    const value = mine[m.key];
    if (value == null || values.length < THRESHOLDS.minPeers) continue;
    metrics.push({
      key: m.key, label: m.label, cheapWhen: m.cheapWhen, value,
      sectorMedian: quantile([...values].sort((a, b) => a - b), 0.5),
      cheapness: cheapness(value, values, m.cheapWhen), peers: values.length,
    });
  }
  const score = metrics.length ? metrics.reduce((s, m) => s + m.cheapness, 0) / metrics.length : null;
  return {
    sector: row.sector ?? null, peers: peers.length, metrics, score,
    verdict: byScore(score, THRESHOLDS.sectorCheap, THRESHOLDS.sectorExpensive),
  };
}

/** Data a partir da qual o resultado anual de `year` se considera conhecido (contas publicadas até ao fim de Março). */
const availableFrom = (year) => `${year + 1}-04-01`;

/**
 * Resultado por acção de um ano: o diluído do Yahoo, salvo quando difere mais de 50 % do resultado líquido a dividir
 * pelo número de acções (há anos com valores claramente errados no Yahoo); nesse caso usa-se o segundo.
 */
export function annualEps(f) {
  const diluted = n(f.dilutedEps);
  const ni = n(f.netIncome);
  const shares = pos(n(f.shares));
  const perShare = ni != null && shares ? ni / shares : null;
  if (diluted == null) return perShare;
  if (perShare != null && perShare > 0 && diluted > 0 && Math.abs(diluted / perShare - 1) > 0.5) return perShare;
  return diluted;
}

/**
 * 2. P/E face à própria história: P/E de cada sessão com o último resultado diluído por acção anual já conhecido.
 * `closes` = [{ date: 'AAAA-MM-DD', close }] por ordem. Só com as contas na moeda da cotação.
 */
export function peHistory(row, financials, closes) {
  const out = { verdict: null, current: null, median: null, p25: null, p75: null, points: 0, series: [] };
  if (!sameCurrency(row)) return { ...out, reason: 'currency' };
  const eps = (financials ?? []).map((f) => ({ from: availableFrom(f.year), eps: annualEps(f) })).filter((e) => e.eps != null)
    .sort((a, b) => a.from.localeCompare(b.from));
  if (eps.length === 0) return { ...out, reason: 'no-eps' };
  const series = [];
  let i = -1;
  for (const q of closes) {
    while (i + 1 < eps.length && eps[i + 1].from <= q.date) i += 1;
    if (i < 0) continue;
    const c = n(q.close);
    if (eps[i].eps > 0 && c > 0) series.push({ date: q.date, pe: c / eps[i].eps });
  }
  if (series.length < THRESHOLDS.historyMinPoints) return { ...out, points: series.length, reason: 'short' };
  const sorted = series.map((s) => s.pe).sort((a, b) => a - b);
  const current = series.at(-1).pe;
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);
  // Uma sessão em cada cinco (aprox. semanal) chega para o gráfico; a última fica sempre.
  const thin = series.filter((_, j) => j % 5 === (series.length - 1) % 5);
  return {
    verdict: current < p25 ? 'cheap' : current > p75 ? 'expensive' : 'fair',
    current, median: quantile(sorted, 0.5), p25, p75, points: series.length,
    from: series[0].date, series: thin.map((s) => ({ date: s.date, pe: Math.round(s.pe * 100) / 100 })),
  };
}

/** 3. Preço-alvo médio dos analistas (na moeda da cotação). */
export function analystTargets(row, close) {
  const c = pos(n(close));
  const count = n(row.analyst_count) ?? 0;
  const mean = pos(n(row.target_mean));
  const base = {
    count, mean, median: pos(n(row.target_median)), low: pos(n(row.target_low)), high: pos(n(row.target_high)),
    recommendation: row.recommendation_key ?? null, recommendationMean: n(row.recommendation_mean),
  };
  if (!c || !mean || count < THRESHOLDS.analystsMin) return { ...base, upside: null, verdict: null };
  const upside = mean / c - 1;
  return {
    ...base, upside,
    verdict: upside >= THRESHOLDS.analystsCheap ? 'cheap' : upside <= THRESHOLDS.analystsExpensive ? 'expensive' : 'fair',
  };
}

/** 4. Número de Graham, em moeda da cotação (resultado e valor contabilístico por acção derivados dos rácios do Yahoo). */
export function graham(row, close) {
  const c = pos(n(close));
  const ref = pos(n(row.ref_price));
  const pe = pos(n(row.trailing_pe));
  const pb = pos(n(row.price_to_book));
  let eps = ref && pe ? ref / pe : null;
  let bvps = ref && pb ? ref / pb : null;
  if (!ref && sameCurrency(row)) {
    eps = n(row.eps);
    bvps = n(row.book_value);
  }
  if (!c || !(eps > 0) || !(bvps > 0)) return { value: null, eps, bookValue: bvps, ratio: null, verdict: null };
  const value = Math.sqrt(22.5 * eps * bvps);
  const ratio = c / value;
  return {
    value, eps, bookValue: bvps, ratio,
    verdict: ratio <= THRESHOLDS.grahamCheap ? 'cheap' : ratio >= THRESHOLDS.grahamExpensive ? 'expensive' : 'fair',
  };
}

/** Valor presente de um fluxo `fcf` a crescer `g` durante `years` anos, com valor terminal a `terminal`. */
export function dcfValue(fcf, g, { discount, terminal, years }) {
  let pv = 0;
  let f = fcf;
  for (let t = 1; t <= years; t += 1) {
    f *= 1 + g;
    pv += f / (1 + discount) ** t;
  }
  return pv + (f * (1 + terminal)) / (discount - terminal) / (1 + discount) ** years;
}

/**
 * 5. DCF invertido (informativo): crescimento anual do fluxo de caixa livre, nos próximos 10 anos, que o preço actual
 * pressupõe (taxa de desconto 9 %, crescimento perpétuo 2 %). Null para bancos, fluxo negativo ou moedas diferentes.
 */
export function reverseDcf(row, close, financials) {
  const t = THRESHOLDS;
  const assumptions = { discount: t.dcfDiscount, terminal: t.dcfTerminal, years: t.dcfYears };
  const c = pos(n(close));
  const ref = pos(n(row.ref_price));
  const mcap = pos(n(row.market_cap));
  const fcf = pos(n(row.free_cashflow));
  const history = revenueGrowth(financials);
  if (FINANCIAL_SECTORS.has(row.sector) || !c || !mcap || !fcf || !sameCurrency(row)) return { impliedGrowth: null, assumptions, revenueCagr: history };
  const equity = mcap * (ref ? c / ref : 1);
  const opts = { discount: t.dcfDiscount, terminal: t.dcfTerminal, years: t.dcfYears };
  let lo = -0.5;
  let hi = 1;
  if (dcfValue(fcf, lo, opts) > equity) return { impliedGrowth: lo, bound: 'below', assumptions, revenueCagr: history };
  if (dcfValue(fcf, hi, opts) < equity) return { impliedGrowth: hi, bound: 'above', assumptions, revenueCagr: history };
  for (let j = 0; j < 80; j += 1) {
    const mid = (lo + hi) / 2;
    if (dcfValue(fcf, mid, opts) < equity) lo = mid;
    else hi = mid;
  }
  return { impliedGrowth: (lo + hi) / 2, bound: null, assumptions, revenueCagr: history };
}

/** Crescimento anual composto das receitas entre o primeiro e o último ano com receitas positivas. */
export function revenueGrowth(financials) {
  const rows = (financials ?? []).filter((f) => n(f.revenue) > 0);
  if (rows.length < 2) return null;
  const first = rows[0];
  const last = rows.at(-1);
  const years = last.year - first.year;
  return years > 0 ? (n(last.revenue) / n(first.revenue)) ** (1 / years) - 1 : null;
}

/** Veredicto global: maioria entre os critérios com dados (pelo menos 2). */
export function overallVerdict(verdicts) {
  const counted = verdicts.filter(Boolean);
  const cheap = counted.filter((v) => v === 'cheap').length;
  const expensive = counted.filter((v) => v === 'expensive').length;
  const total = counted.length;
  const half = Math.ceil(total / 2);
  let verdict = 'insufficient';
  if (total >= 2) verdict = cheap > expensive && cheap >= half ? 'cheap' : expensive > cheap && expensive >= half ? 'expensive' : 'fair';
  return { verdict, cheap, expensive, fair: total - cheap - expensive, total };
}

/** Valorização completa. */
export function valuation({ row, close, closeDate, financials, closes, peers }) {
  const sector = sectorComparison(row, close, peers);
  const history = peHistory(row, financials, closes);
  const analysts = analystTargets(row, close);
  const grahamNumber = graham(row, close);
  const dcf = reverseDcf(row, close, financials);
  return {
    price: n(close), priceDate: closeDate ?? null, currency: row.currency ?? null,
    summary: overallVerdict([sector.verdict, history.verdict, analysts.verdict, grahamNumber.verdict]),
    sector, history, analysts, graham: grahamNumber, dcf,
    metrics: currentMetrics(row, close),
  };
}
