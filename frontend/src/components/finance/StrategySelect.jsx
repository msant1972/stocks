import { useId } from 'react';
import { STRATEGIES } from '../../lib/strategy.js';
import { useStrategies } from '../../lib/queries.js';

/**
 * Menu das estratégias ligadas do registo (shared/strategies/; ligam-se e desligam-se em Definições → Estratégias).
 * allowNone acrescenta «Nenhuma» (valor null); best marca a estratégia com melhor resultado.
 */
export default function StrategySelect({ value, onChange, allowNone = false, best = null, disabled, compact }) {
  const id = useId();
  const { isEnabled } = useStrategies();
  const shown = STRATEGIES.filter((s) => s.available && isEnabled(s.id)); // as desligadas nas Definições não aparecem
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <label htmlFor={id} className={compact ? 'visually-hidden' : 'small'} style={{ whiteSpace: 'nowrap' }}>Estratégia</label>
      <select id={id} className="select" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}
        style={{ minHeight: '2.75rem', width: 'auto' }} title="Simular no histórico uma estratégia (não envia ordens nem altera a carteira)">
        {allowNone && <option value="">Nenhuma</option>}
        {shown.map((s) => <option key={s.id} value={s.id}>{s.id === best ? `${s.name} (melhor)` : s.name}</option>)}
      </select>
    </div>
  );
}
