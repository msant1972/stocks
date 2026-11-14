import { useId } from 'react';
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as f from '../../lib/format.js';

function CurveTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card" style={{ padding: '0.5rem 0.75rem', boxShadow: 'var(--shadow-overlay)', minWidth: '11rem' }}>
      <div className="small muted">{f.date(p.date)}</div>
      <div className={`num ${p.pnl >= 0 ? 'positive' : 'negative'}`} style={{ fontWeight: 600 }}>{f.signedMoney(p.pnl)}</div>
      <div className="small muted">{p.positions} {p.positions === 1 ? 'posição' : 'posições'}</div>
    </div>
  );
}

/** Resultado acumulado da rotação (antes de custos), uma leitura por semana. */
export default function RotationChart({ curve }) {
  const id = useId();
  const last = curve.at(-1);
  return (
    <>
      <div className="chart-box" role="img" aria-labelledby={`${id}-summary`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={f.shortDate} minTickGap={40} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
            <YAxis width={84} tickFormatter={(v) => f.money(v, 'EUR', 0)} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
            <Tooltip content={<CurveTooltip />} />
            <ReferenceLine y={0} stroke="var(--text-secondary)" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="pnl" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} name="Resultado acumulado" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p id={`${id}-summary`} className="small muted" style={{ marginTop: '0.5rem' }}>
        De {f.date(curve[0].date)} a {f.date(last.date)}: resultado acumulado de {f.signedMoney(last.pnl)} antes de custos.
      </p>
    </>
  );
}
