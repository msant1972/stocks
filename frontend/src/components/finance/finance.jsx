import * as f from '../../lib/format.js';

/** Variação com sinal, texto e cor: nunca só a cor (guia, secção 3.1). */
export function PriceChange({ value, showLabel = true }) {
  if (value == null) return <span className="muted">—</span>;
  const t = f.trend(value);
  return (
    <span className={`num ${t.tone}`}>
      {f.pct(value)}{showLabel && <span className="small"> · {t.label}</span>}
    </span>
  );
}

export function PnL({ value, currency = 'EUR' }) {
  if (value == null) return <span className="muted">—</span>;
  const n = Number(value);
  return <span className={`num ${n > 0 ? 'positive' : n < 0 ? 'negative' : ''}`}>{f.signedMoney(value, currency)}</span>;
}

/** Data da sessão, sempre visível junto aos preços. */
export function QuoteDate({ date, prefix = 'Fecho de' }) {
  if (!date) return <span className="muted small">Sem cotações</span>;
  const age = f.daysSince(date);
  return (
    <span className={`small ${age > 4 ? 'warning-text' : 'muted'}`}>
      {prefix} {f.date(date)}{age > 4 ? ' · desactualizado' : ''}
    </span>
  );
}

const STATUS = {
  pending: { label: 'A validar', cls: 'badge-warning' },
  active: { label: 'Activo', cls: 'badge-positive' },
  invalid: { label: 'Inválido', cls: 'badge-negative' },
};

export function InstrumentStatus({ status }) {
  const s = STATUS[status] ?? STATUS.pending;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export function SimulatedBadge() {
  return <span className="badge badge-accent">Ambiente de simulação</span>;
}
