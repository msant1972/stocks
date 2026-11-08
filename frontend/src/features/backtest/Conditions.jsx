import * as f from '../../lib/format.js';
import { COST_OPTIONS, PERIOD_OPTIONS } from '../../lib/testConditions.js';
import { Segmented } from '../../components/ui/controls.jsx';

/** Período e custos do teste (BackTest e Comparar). */
export function ConditionControls({ conditions, onChange }) {
  return (
    <>
      <Segmented label="Período" value={conditions.period} onChange={(period) => onChange({ ...conditions, period })} options={PERIOD_OPTIONS} />
      <Segmented label="Custos" value={conditions.costs ? 'net' : 'gross'} onChange={(v) => onChange({ ...conditions, costs: v === 'net' })} options={COST_OPTIONS} />
    </>
  );
}

/** Nota sobre as condições: datas do período de verificação, histórico em falta e modelo de custos. */
export function ConditionsNote({ data, conditions }) {
  if (!data) return null;
  const parts = [];
  if (conditions.period === 'verification') {
    parts.push(`Período de verificação${data.fromDate ? ` (${f.date(data.fromDate)} a ${f.date(data.toDate)})` : ''}: os 2 anos antes dos usados para afinar as estratégias, para ver se o resultado se repete em dados novos para elas.`);
    if (data.fullHistory != null && data.instruments > data.fullHistory) {
      parts.push(`Só ${data.fullHistory} de ${data.instruments} instrumentos têm cotações em todo o período; os restantes entram só com as sessões que têm.`);
    }
  }
  if (conditions.costs && data.costModel) parts.push(`Custos estimados: ${data.costModel.text}; a posição aberta no fim conta como vendida ao último preço. Estimativa: confirme na tabela de preços da SAXO.`);
  return parts.length ? <p className="small muted" style={{ margin: 0 }}>{parts.join(' ')}</p> : null;
}
