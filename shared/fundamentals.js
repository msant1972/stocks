/**
 * Pontuação de valor e qualidade (fatores fundamentais) a partir do perfil das empresas (company_profiles, fonte: Yahoo).
 *
 * Valor: rendimento dos resultados (1 / P/E, só com resultados positivos) e rendimento do fluxo de caixa livre (FCF / capitalização).
 * Qualidade: rentabilidade dos capitais próprios (ROE), margem líquida e baixa dívida (dívida / capitais próprios). Cada indicador
 * vira um percentil entre as empresas que o têm; a pontuação é a média dos percentis disponíveis (mínimo de 4 em 5).
 *
 * ATENÇÃO: só há os valores de hoje (sem histórico de fundamentais por data), por isso esta pontuação NÃO se pode testar no
 * passado: um teste mostraria o futuro (viés de antecipação). É um ecrã informativo, não uma estratégia simulada.
 */
export const MIN_FIELDS = 4;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Indicadores de uma empresa: { earningsYield, fcfYield, roe, margin, leverage }, null onde falta ou não faz sentido. */
export function metrics(r) {
  const pe = num(r.trailingPe);
  const cap = num(r.marketCap);
  const fcf = num(r.freeCashflow);
  const sameCurrency = !r.currency || !r.financialCurrency || r.currency === r.financialCurrency;
  const debt = num(r.debtToEquity);
  return {
    earningsYield: pe != null && pe > 0 ? 1 / pe : null,
    fcfYield: sameCurrency && cap != null && cap > 0 && fcf != null ? fcf / cap : null,
    roe: num(r.returnOnEquity),
    margin: num(r.profitMargin),
    leverage: debt != null && debt >= 0 ? -debt : null, // dívida menor = melhor
  };
}

/** Percentil (0 a 1) de cada valor entre os não nulos, com empates pela média; null mantém-se null. */
export function percentiles(values) {
  const idx = values.map((v, i) => [v, i]).filter(([v]) => v != null).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length).fill(null);
  const n = idx.length;
  if (n === 0) return out;
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && idx[j + 1][0] === idx[k][0]) j += 1;
    const p = n === 1 ? 0.5 : (k + j) / 2 / (n - 1);
    for (let m = k; m <= j; m++) out[idx[m][1]] = p;
    k = j + 1;
  }
  return out;
}

/**
 * rows: [{ instrumentId, symbol, name, sector, trailingPe, marketCap, freeCashflow, returnOnEquity, profitMargin, debtToEquity,
 * currency, financialCurrency }]. Devolve as empresas com pontuação, da melhor para a pior, com `score`, `value`, `quality`
 * (0 a 1), os indicadores e o lugar (rank).
 */
export function fundamentalScores(rows, { minFields = MIN_FIELDS } = {}) {
  const ms = rows.map(metrics);
  const keys = ['earningsYield', 'fcfYield', 'roe', 'margin', 'leverage'];
  const pct = Object.fromEntries(keys.map((k) => [k, percentiles(ms.map((m) => m[k]))]));
  const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const out = [];
  rows.forEach((r, i) => {
    const p = keys.map((k) => pct[k][i]);
    if (p.filter((x) => x != null).length < minFields) return;
    out.push({
      instrumentId: r.instrumentId, symbol: r.symbol, name: r.name ?? null, sector: r.sector ?? null,
      ...ms[i], score: mean(p), value: mean([pct.earningsYield[i], pct.fcfYield[i]]), quality: mean([pct.roe[i], pct.margin[i], pct.leverage[i]]),
    });
  });
  out.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  out.forEach((x, k) => { x.rank = k + 1; });
  return out;
}
