import { useId } from 'react';
import { STRATEGIES } from '../../lib/strategy.js';

/**
 * Menu de estratégias do registo (shared/strategies/). As que ainda estão em preparação aparecem
 * desactivadas. allowNone acrescenta «Nenhuma» (valor null); best marca a estratégia com melhor resultado.
 */
export default function StrategySelect({ value, onChange, allowNone = false, best = null, disabled, compact }) {
  const id = useId();
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <label htmlFor={id} className={compact ? 'visually-hidden' : 'small'} style={{ whiteSpace: 'nowrap' }}>Estratégia</label>
      <select id={id} className="select" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}
        style={{ minHeight: '2.75rem', width: 'auto' }} title="Simular no histórico uma estratégia (não envia ordens nem altera a carteira)">
        {allowNone && <option value="">Nenhuma</option>}
        {STRATEGIES.map((s) => (
          <option key={s.id} value={s.id} disabled={!s.available}>
            {!s.available ? `${s.name} (em preparação)` : s.id === best ? `${s.name} (melhor)` : s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
