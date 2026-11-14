/**
 * Promessas — instrumentos com mais probabilidade de darem oportunidades de negociação às estratégias nos meses seguintes.
 *
 * Pontuação revista a 14 nov. 2026 (docs/arquitectura/promessas.md), validada em 42 datas mensais (jan. 2023 a abr. 2026, sinais
 * calculados só com os dados de cada data): nos 6 meses seguintes, as estratégias ligadas (a começar sem posição) ganharam em média
 * 2 184 € por estratégia e instrumento nos 30 primeiros, contra 862 € no catálogo e 1 566 € com a pontuação anterior, e os 30
 * primeiros bateram o catálogo em 37 das 42 datas.
 *
 * Elegibilidade (a tendência mantém-se nos últimos 3 meses): fecho acima da SMA200, SMA50 acima da SMA200 e rendimento de 3 meses
 * positivo. Pontuação: média ponderada dos percentis, em todo o catálogo, de
 *   M2 (momentum 12-1 / volatilidade), inclinação da SMA200 em 3 meses e distância da SMA50 à SMA200 (peso 1 cada: tendência longa),
 *   valor negociado médio de 50 sessões (liquidez) e parte das sessões a subir nos últimos 3 meses (regularidade), peso ½ cada.
 * A volatilidade baixa saiu da pontuação: não prevê o resultado das estratégias (ajuda as de tendência, prejudica as de mergulho).
 * Cálculo sobre o fecho ajustado. Não é uma previsão segura nem uma recomendação.
 */
import { rollingMean } from './momentum.js';
import { m2Series, prepare } from './strategies/b-opus.js';

export const WEIGHTS = { m2: 1, s200slope: 1, s50over200: 1, liq: 0.5, upDays63: 0.5 };
/** Pesos até 14 nov. 2026 (para comparação nos testes e na validação). */
export const PREVIOUS_WEIGHTS = { m2: 2, vol63: -1, s200slope: 1 };
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
  const hi20 = Math.max(...C.slice(i - 19));
  let up = 0;
  let down = 0;
  for (let k = i - 13; k <= i; k++) { const d = C[k] - C[k - 1]; if (d > 0) up += d; else down -= d; }
  let traded = 0;
  for (let k = i - 49; k <= i; k++) traded += bars[k].closeRaw * bars[k].volume;
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
    s50over200: s50[i] / s200[i] - 1,
    upDays63: rets.filter((r) => r > 0).length / rets.length,
    liq: traded / 50, // valor negociado médio de 50 sessões, na moeda da cotação
    rsi14: up + down > 0 ? (100 * up) / (up + down) : 50,
    dip20: C[i] / hi20 - 1,
  };
}

/**
 * Onde está o preço agora, para saber que tipo de entrada é mais provável: 'pullback' (em recuo: RSI14 abaixo de 45 ou 5 % ou mais
 * abaixo do máximo de 20 sessões; é onde compram as estratégias de mergulho e de ondas), 'high' (a 3 % ou menos do máximo de 52
 * semanas; é onde compram as de rotura e de momentum) ou 'mid'. Descritivo: não entra na pontuação.
 */
export function setup(f) {
  if (!f) return null;
  if (f.rsi14 < 45 || f.dip20 <= -0.05) return 'pullback';
  if (f.distHigh >= -0.03) return 'high';
  return 'mid';
}

/** Elegível: a tendência mantém-se nos últimos 3 meses. */
export const eligible = (f) => f != null && f.aboveS200 && f.s50AboveS200 && f.r63 > 0 && f.m2 != null;

/**
 * Pontua uma lista de { features } (todo o catálogo): score de 0 a 100 pela média ponderada dos percentis.
 * Devolve uma nova lista com score, eligible e rank (1 = melhor, só entre os elegíveis), ordenada por score.
 */
export function rank(items, weights = WEIGHTS) {
  const withF = items.filter((x) => x.features && x.features.m2 != null);
  const n = withF.length;
  const total = Object.values(weights).reduce((s, w) => s + Math.abs(w), 0);
  const score = new Map(withF.map((x) => [x, 0]));
  for (const [key, w] of Object.entries(weights)) {
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
