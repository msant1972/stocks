/**
 * Fases de Wyckoff — em que fase do ciclo está cada instrumento (docs/arquitectura/Wyckoff.md).
 *
 * A teoria descreve quatro fases: acumulação (faixa lateral depois de uma queda), subida, distribuição (faixa lateral depois de
 * uma subida) e queda. Aqui cada fase é uma regra sobre as cotações diárias (fecho ajustado) e o volume:
 *
 *  - faixa lateral: nas últimas `window` sessões, a distância entre o fecho mais alto e o mais baixo é pequena para o que é
 *    normal neste instrumento — menos de `tightness` vezes a volatilidade diária de um ano × √window (um passeio aleatório
 *    daria cerca de 1,6);
 *  - acumulação: faixa lateral no terço inferior do intervalo de 52 semanas, depois de uma queda de pelo menos `minDrop` desde
 *    o máximo de 52 semanas;
 *  - distribuição: faixa lateral no terço superior desse intervalo, depois de uma subida de pelo menos `minRise` desde o mínimo
 *    de 52 semanas;
 *  - subida: fora de uma faixa dessas, com o fecho acima da SMA50, a SMA50 a subir e 3 meses positivos;
 *  - queda: o inverso (fecho abaixo da SMA50, SMA50 a descer e 3 meses negativos);
 *  - indefinida: o resto (faixas laterais a meio do intervalo, viragens).
 *
 * `volumeBias` diz de que lado esteve o volume dentro da janela (de −1 a 1: dias de subida menos dias de queda, em parte do
 * volume total): positivo numa acumulação e negativo numa distribuição é o que a teoria espera. É informativo; não decide a fase.
 *
 * Só usa dados até à sessão pedida (sem lookahead). Não é uma previsão nem uma recomendação.
 */
import { rollingMean } from './momentum.js';
import { prepare } from './strategies/b-opus.js';

export const PHASES = ['accumulation', 'markup', 'distribution', 'markdown', 'undefined'];

export const DEFAULT_OPTIONS = {
  window: 40,        // sessões da faixa (8 semanas)
  tightness: 1.3,    // largura máxima da faixa, em volatilidades diárias de um ano × √window
  yearSessions: 252, // intervalo de 52 semanas
  low: 1 / 3,        // a faixa está «em baixo» se o seu meio ficar neste terço do intervalo de 52 semanas
  high: 2 / 3,       // … e «em cima» a partir daqui
  minDrop: 0.20,     // queda mínima desde o máximo de 52 semanas, para ser acumulação
  minRise: 0.25,     // subida mínima desde o mínimo de 52 semanas, para ser distribuição
  trendSma: 50,
  slopeSessions: 20, // a SMA50 «sobe» se for maior do que há estas sessões
  momentumSessions: 63,
};

/** Sessões de histórico necessárias (52 semanas mais uma, para os rendimentos diários). */
export const sessionsNeeded = (o = DEFAULT_OPTIONS) => o.yearSessions + 1;

/** Prepara as séries de um instrumento (quotes como em daily_quotes, por ordem cronológica). */
export function prepareSeries(quotes, o = DEFAULT_OPTIONS) {
  const { bars } = prepare(quotes);
  const C = bars.map((b) => b.C);
  return {
    dates: bars.map((b) => b.date), C, f: bars.map((b) => b.f), volume: bars.map((b) => b.volume), sma: rollingMean(C, o.trendSma),
  };
}

/**
 * Fase na sessão i de uma série preparada, ou null sem histórico suficiente. Devolve
 * { phase, date, lateral, width, tightness, position, support, resistance, rangeSessions, volumeBias }:
 * support e resistance são os limites da faixa (fecho mais baixo e mais alto da janela), a preços de hoje (não ajustados);
 * rangeSessions é há quantas sessões o fecho anda dentro dessa faixa; position é o lugar do meio da faixa no intervalo de 52
 * semanas (0 = no mínimo, 1 = no máximo).
 */
export function phaseAt(s, i, o = DEFAULT_OPTIONS) {
  if (i < sessionsNeeded(o) - 1 || i >= s.C.length) return null;
  const { C } = s;
  // Faixa das últimas `window` sessões.
  let hi = -Infinity;
  let lo = Infinity;
  let upVol = 0;
  let downVol = 0;
  for (let k = i - o.window + 1; k <= i; k++) {
    if (C[k] > hi) hi = C[k];
    if (C[k] < lo) lo = C[k];
    if (C[k] > C[k - 1]) upVol += s.volume[k]; else if (C[k] < C[k - 1]) downVol += s.volume[k];
  }
  // Volatilidade diária de um ano e intervalo de 52 semanas.
  let hiYear = -Infinity;
  let loYear = Infinity;
  let sum = 0;
  let sumSq = 0;
  for (let k = i - o.yearSessions + 1; k <= i; k++) {
    if (C[k] > hiYear) hiYear = C[k];
    if (C[k] < loYear) loYear = C[k];
    const r = Math.log(C[k] / C[k - 1]);
    sum += r;
    sumSq += r * r;
  }
  const n = o.yearSessions;
  const sigma = Math.sqrt(Math.max(0, (sumSq - (sum * sum) / n) / (n - 1)));
  const width = hi / lo - 1;
  const tightness = sigma > 0 ? Math.log(hi / lo) / (sigma * Math.sqrt(o.window)) : Infinity;
  const lateral = tightness <= o.tightness;
  const mid = (hi + lo) / 2;
  const position = hiYear > loYear ? (mid - loYear) / (hiYear - loYear) : 0.5;

  let phase = 'undefined';
  if (lateral && position <= o.low && hi / hiYear - 1 <= -o.minDrop) phase = 'accumulation';
  else if (lateral && position >= o.high && lo / loYear - 1 >= o.minRise) phase = 'distribution';
  else if (!lateral) {
    const sma = s.sma[i];
    const before = s.sma[i - o.slopeSessions];
    const momentum = C[i] / C[i - o.momentumSessions] - 1;
    if (C[i] > sma && sma > before && momentum > 0) phase = 'markup';
    else if (C[i] < sma && sma < before && momentum < 0) phase = 'markdown';
  }

  // Há quantas sessões o fecho anda dentro da faixa (com 1 % de folga).
  let rangeSessions = o.window;
  if (lateral) for (let k = i - o.window; k >= 1 && C[k] <= hi * 1.01 && C[k] >= lo * 0.99; k--) rangeSessions += 1;
  const total = upVol + downVol;
  return {
    phase, date: s.dates[i], lateral, width, tightness, position,
    support: lo / s.f[i], resistance: hi / s.f[i], rangeSessions: lateral ? rangeSessions : null,
    volumeBias: total > 0 ? (upVol - downVol) / total : 0,
  };
}

/** Fase na última sessão das cotações dadas (ou null sem histórico suficiente). */
export function phase(quotes, o = DEFAULT_OPTIONS) {
  const s = prepareSeries(quotes, o);
  return phaseAt(s, s.C.length - 1, o);
}
