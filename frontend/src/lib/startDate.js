/** Data de início das carteiras simuladas (Portfolio Recomendado e Rotação): validação no browser e a data gravada por utilizador. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

/**
 * Erro da data de início (texto) ou null se for válida: vazia (últimos 24 meses), ou entre minStart (primeira data com histórico
 * para a pontuação) e a véspera da última sessão.
 */
export function startError(value, { minStart, latestSession }) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Data inválida.';
  if (minStart && value < minStart) return `Sem histórico suficiente antes de ${minStart.split('-').reverse().join('/')}: escolha a partir dessa data.`;
  if (latestSession && value >= latestSession) return `Tem de ser anterior à última sessão (${latestSession.split('-').reverse().join('/')}).`;
  return null;
}

/** Data de início por omissão, enquanto o utilizador não escolher outra (nem o período do módulo). */
export const DEFAULT_START = '2026-01-01';

/**
 * Data de início gravada pelo utilizador para um módulo ('recommended-portfolio' ou 'rotation'), na base de dados
 * (GET/PUT /portfolio-start-dates): mantém-se até ser alterada. Sem nada gravado, DEFAULT_START; gravado null, o período do
 * módulo (sem data). Devolve { start, isDefault, ready, save(value|null) }; isDefault: nada gravado (vale DEFAULT_START).
 */
export function useStartDate(module) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portfolio-start-dates'], queryFn: () => api.get('/portfolio-start-dates'), staleTime: Infinity });
  const row = q.data?.items.find((i) => i.module === module);
  const start = row ? row.start : DEFAULT_START;
  const save = async (value) => {
    await api.put(`/portfolio-start-dates/${module}`, { start: value || null });
    await qc.invalidateQueries({ queryKey: ['portfolio-start-dates'] });
  };
  return { start, isDefault: !row, ready: !q.isPending, save };
}
