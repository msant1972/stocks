/**
 * Estratégia de cada instrumento para um utilizador: a escolhida no Charts ou, sem escolha, a melhor.
 *
 * Usada pela Automação (só compra um instrumento pela sua estratégia), pelos Sinais e pelos sinais da Visão geral (filtro) e
 * pelo menu do Charts. Função pura, partilhada pela API e pela interface.
 *
 *  - choice: undefined (sem escolha), null («Nenhuma», escolha explícita de não negociar) ou o id de uma estratégia;
 *  - best: { strategyId, total } da melhor estratégia ligada no BackTest dos últimos 2 anos (ou undefined);
 *  - isEnabled(id): se a estratégia está ligada em Definições → Estratégias.
 *
 * Devolve { strategyId, source }: source 'chosen' (a escolhida), 'none' («Nenhuma» escolhida, strategyId null), 'best' (sem
 * escolha, ou a escolhida foi desligada em Definições: vale a melhor, se tiver ganho) ou 'unset' (sem escolha e nenhuma ganha:
 * strategyId null).
 */
export function effectiveStrategy({ choice, best, isEnabled }) {
  if (choice === null) return { strategyId: null, source: 'none' };
  if (choice !== undefined && isEnabled(choice)) return { strategyId: choice, source: 'chosen' };
  if (best && best.total > 0 && isEnabled(best.strategyId)) return { strategyId: best.strategyId, source: 'best' };
  return { strategyId: null, source: 'unset' };
}

/** Mapa instrumento → estratégia efectiva (só o id, ou null) para os ids dados. choices: Map(id → id|null). */
export function effectiveMap(ids, { choices, best, isEnabled }) {
  const out = new Map();
  for (const id of ids) out.set(id, effectiveStrategy({ choice: choices.has(id) ? choices.get(id) : undefined, best: best.get(id), isEnabled }).strategyId);
  return out;
}
