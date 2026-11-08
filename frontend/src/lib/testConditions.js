/**
 * Condições do teste das estratégias (BackTest e Comparar), lidas do endereço: período (?periodo=verificacao) e custos
 * (?custos=1). Funções puras, testadas com node --test.
 */
export const PERIOD_OPTIONS = [
  { value: 'recent', label: 'Últimos 2 anos' },
  { value: 'verification', label: 'Verificação' },
];
export const COST_OPTIONS = [
  { value: 'gross', label: 'Sem custos' },
  { value: 'net', label: 'Com custos SAXO' },
];

/** { period: 'recent' | 'verification', costs: boolean } a partir de URLSearchParams. */
export function readConditions(params) {
  return { period: params.get('periodo') === 'verificacao' ? 'verification' : 'recent', costs: params.get('custos') === '1' };
}

/** Alterações ao endereço para um período e uns custos (null apaga o parâmetro, que é a omissão). */
export function conditionParams({ period, costs }) {
  return { periodo: period === 'verification' ? 'verificacao' : null, custos: costs ? '1' : null };
}

/** Parte da query da API: &period=…&costs=… */
export const conditionQuery = ({ period, costs }) => `period=${period}&costs=${costs ? 'true' : 'false'}`;

/** Frase que descreve as condições, para as introduções das páginas. */
export function describeConditions({ period, costs }, years = 2) {
  const when = period === 'verification'
    ? `nos ${years} anos anteriores aos últimos ${years} (período de verificação: dados que não serviram para afinar as estratégias)`
    : `nos últimos ${years} anos`;
  return `${when}, ${costs ? 'depois dos custos estimados da SAXO' : 'sem comissões nem outros custos'}`;
}

const mode = (xs) => {
  const n = new Map();
  for (const x of xs) if (x != null) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/** Janela mais comum e instrumentos com histórico em toda ela (≥ 95 % das sessões do que tem mais), das linhas do BackTest. */
export function windowSummary(items) {
  const max = Math.max(0, ...items.map((i) => i.sessions));
  return {
    fromDate: mode(items.map((i) => i.windowFrom)), toDate: mode(items.map((i) => i.toDate)),
    instruments: items.length, fullHistory: items.filter((i) => max > 0 && i.sessions >= 0.95 * max).length,
  };
}
