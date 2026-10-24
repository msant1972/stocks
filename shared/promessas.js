/**
 * Promessas — instrumentos com mais probabilidade de serem ganhadores nos 12 meses seguintes.
 *
 * Pontuação validada a 24 out. 2026 em 5 janelas do passado (sinais calculados só com os dados disponíveis em
 * cada data; docs/arquitectura/promessas.md): os 30 melhores tiveram em média +16 pontos percentuais de
 * instrumentos ganhadores nas três estratégias e +6,7 pontos de rendimento face ao catálogo.
 *
 * Elegibilidade (sinais dos últimos 3 meses de que a tendência se mantém): fecho acima da SMA200, SMA50 acima da
 * SMA200 e rendimento de 3 meses positivo. Pontuação: média ponderada dos percentis, em todo o catálogo, de
 *   M2 (momentum 12-1 / volatilidade, peso 2), volatilidade de 3 meses (menor é melhor, peso 1) e
 *   inclinação da SMA200 em 3 meses (peso 1).
 * Cálculo sobre o fecho ajustado. Não é uma previsão segura nem uma recomendação.
 */
import { rollingMean } from './momentum.js';
import { m2Series, prepare } from './strategies/b-opus.js';

export const WEIGHTS = { m2: 2, vol63: -1, s200slope: 1 };
export const TOP_N = 30;
export const SESSIONS_NEEDED = 316; // 253 para o M2 + 63 para a inclinação da SMA200

/** Sinais de um instrumento na última sessão (ou null sem histórico suficiente). quotes como em daily_quotes. */
export function features(quotes) {
  const { bars } = prepare(quotes);
  const n = bars.length;
  if (n < SESSIONS_NEEDED) return null;
  const C = bars.map((b) => b.C);
  const i = n - 1;
  const s50 = rollingMean(C, 50);
  const s200 = rollingMean(C, 200);
  const m2 = m2Series(C, 252, 21);
  const rets = [];
  for (let k = i - 62; k <= i; k++) rets.push(C[k] / C[k - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const vol63 = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);
  const hi252 = Math.max(...C.slice(i - 251));
  return {
    date: bars[i].date,
    close: bars[i].closeRaw,
    m2: m2[i],
    vol63,
    s200slope: s200[i] / s200[i - 63] - 1,
    aboveS200: C[i] > s200[i],
    s50AboveS200: s50[i] > s200[i],
    r63: C[i] / C[i - 63] - 1,
    r252: C[i] / C[i - 252] - 1,
    distHigh: C[i] / hi252 - 1,
  };
}

/** Elegível: a tendência mantém-se nos últimos 3 meses. */
export const eligible = (f) => f != null && f.aboveS200 && f.s50AboveS200 && f.r63 > 0 && f.m2 != null;

/**
 * Pontua uma lista de { features } (todo o catálogo): score de 0 a 100 pela média ponderada dos percentis.
 * Devolve uma nova lista com score, eligible e rank (1 = melhor, só entre os elegíveis), ordenada por score.
 */
export function rank(items) {
  const withF = items.filter((x) => x.features && x.features.m2 != null);
  const n = withF.length;
  const total = Object.values(WEIGHTS).reduce((s, w) => s + Math.abs(w), 0);
  const score = new Map(withF.map((x) => [x, 0]));
  for (const [key, w] of Object.entries(WEIGHTS)) {
    const sorted = [...withF].sort((a, b) => Math.sign(w) * (a.features[key] - b.features[key]));
    sorted.forEach((x, pos) => score.set(x, score.get(x) + (Math.abs(w) * (n > 1 ? pos / (n - 1) : 1)) / total));
  }
  const out = withF
    .map((x) => ({ ...x, score: Math.round(score.get(x) * 1000) / 10, eligible: eligible(x.features) }))
    .sort((a, b) => b.score - a.score || a.symbol?.localeCompare?.(b.symbol));
  let r = 0;
  for (const x of out) x.rank = x.eligible ? ++r : null;
  return out;
}
