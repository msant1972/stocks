/**
 * Fases de Wyckoff na interface (GET /wyckoff; regras em shared/wyckoff.js, estudo em docs/arquitectura/Wyckoff.md).
 * Etiqueta, cor e explicação de cada fase. Desde 17 nov. 2026, as faixas laterais chamam-se «Faixa no fundo» e «Faixa no topo» (os
 * identificadores continuam accumulation e distribution): a teoria só distingue acumulação de redistribuição, e distribuição de
 * reacumulação, pela saída da faixa, que a regra não detecta. A explicação diz o que a teoria espera e o que os nossos dados mostraram: nos anos
 * de subida (2023 a 2026) as fases deram o contrário da teoria; no mercado em queda de 2022, deram o que a teoria diz.
 */
export const PHASE_ORDER = ['accumulation', 'markup', 'distribution', 'markdown', 'undefined'];

export const PHASE_INFO = {
  accumulation: {
    label: 'Faixa no fundo', tone: 'badge-accent',
    help: 'Faixa lateral estreita perto dos mínimos de 52 semanas, depois de uma queda de 20 % ou mais. Pela teoria de Wyckoff pode ser '
      + 'acumulação (antecede uma subida) ou redistribuição (uma pausa antes de mais queda); só a saída da faixa diz qual. '
      + 'Nos nossos dados (2023 a 2026) foi o grupo mais fraco: 6 meses depois, +1,9 % em média (catálogo +8,4 %), e as estratégias ligadas '
      + 'não ganharam (−27 € por estratégia; catálogo 490 €). No mercado em queda de 2022 foi o contrário: ficou acima do catálogo.',
  },
  markup: {
    label: 'Subida', tone: 'badge-positive',
    help: 'Fora de uma faixa lateral, com o fecho acima da média de 50 sessões, a média a subir e 3 meses positivos. '
      + 'Nos nossos dados: 6 meses depois, +9,9 % em média (catálogo +8,4 %); as estratégias ligadas ganharam 738 € por estratégia (catálogo 490 €).',
  },
  distribution: {
    label: 'Faixa no topo', tone: 'badge-warning',
    help: 'Faixa lateral estreita perto dos máximos de 52 semanas, depois de uma subida de 25 % ou mais. Pela teoria de Wyckoff pode ser '
      + 'distribuição (antecede uma queda) ou reacumulação (uma pausa antes de mais subida); só a saída da faixa diz qual. '
      + 'Nos nossos dados (2023 a 2026) foi quase sempre reacumulação: 6 meses depois, +11,4 % em média (catálogo +8,4 %) e 70 % estavam '
      + 'mais altas; as estratégias ligadas ganharam 850 € por estratégia (catálogo 490 €). No mercado em queda de 2022 foi distribuição: '
      + 'o pior grupo (−978 € por estratégia; catálogo −349 €).',
  },
  markdown: {
    label: 'Queda', tone: 'badge-negative',
    help: 'Fora de uma faixa lateral, com o fecho abaixo da média de 50 sessões, a média a descer e 3 meses negativos. '
      + 'Nos nossos dados: 6 meses depois, +7,4 % em média (catálogo +8,4 %); as estratégias ligadas ganharam 257 € por estratégia (catálogo 490 €).',
  },
  undefined: {
    label: 'Indefinida', tone: '',
    help: 'Nenhuma das quatro fases: faixa lateral a meio do intervalo de 52 semanas, ou tendência a mudar. '
      + 'Nos nossos dados: 6 meses depois, +7,0 % em média (catálogo +8,4 %); as estratégias ligadas ganharam 281 € por estratégia (catálogo 490 €).',
  },
};

export const phaseLabel = (phase) => PHASE_INFO[phase]?.label ?? '—';

/** Texto curto da faixa lateral, para o `title` da etiqueta: há quantas sessões, e de que lado esteve o volume. */
export function rangeNote(w) {
  if (!w?.lateral || w.rangeSessions == null) return '';
  const side = w.volumeBias > 0.05 ? 'mais volume nos dias de subida' : w.volumeBias < -0.05 ? 'mais volume nos dias de queda' : 'volume equilibrado';
  return `Em faixa há ${w.rangeSessions} sessões; ${side}.`;
}

/** Posição da fase para ordenar (faixa no fundo, subida, faixa no topo, queda, indefinida); sem fase fica no fim (null). */
export const phaseRank = (phase) => { const k = PHASE_ORDER.indexOf(phase); return k < 0 ? null : k; };

/** Opções de um filtro por fase, com a contagem de cada uma: [{ value, label }], a começar por «Todas». */
export function phaseOptions(counts = null) {
  return [{ value: 'all', label: 'Todas as fases' }, ...PHASE_ORDER.map((p) => ({ value: p, label: counts ? `${PHASE_INFO[p].label} (${counts[p] ?? 0})` : PHASE_INFO[p].label }))];
}
