import { useId } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as f from '../../lib/format.js';

function HistoryTooltip({ active, payload, initial }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card" style={{ padding: '0.5rem 0.75rem', boxShadow: 'var(--shadow-overlay)', minWidth: '12rem' }}>
      <div className="small muted">{f.date(p.date)}</div>
      <div className="num" style={{ fontWeight: 600 }}>{f.money(p.total)}</div>
      {p.positions != null && p.cash != null && <div className="small muted">Posições {f.money(p.positions)} · Saldo {f.money(p.cash)}</div>}
      <div className={`small num ${p.total >= initial ? 'positive' : 'negative'}`}>{f.signedMoney(p.total - initial)} face ao capital inicial</div>
    </div>
  );
}

/** Evolução do valor total da conta SAXO (uma leitura no fim de cada sessão), com o capital inicial como referência. */
export default function AccountHistoryChart({ history }) {
  const id = useId();
  const { points, initialCapital } = history;
  const last = points.at(-1);
  const min = Math.min(initialCapital, ...points.map((p) => p.total));
  const max = Math.max(initialCapital, ...points.map((p) => p.total));
  const pad = Math.max((max - min) * 0.1, initialCapital * 0.005);
  return (
    <>
      <div className="chart-box" role="img" aria-labelledby={`${id}-summary`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={f.shortDate} minTickGap={40} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
            <YAxis domain={[min - pad, max + pad]} width={84} tickFormatter={(v) => f.money(v, 'EUR', 0)} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
            <Tooltip content={<HistoryTooltip initial={initialCapital} />} />
            <ReferenceLine y={initialCapital} stroke="var(--text-secondary)" strokeDasharray="4 4"
              label={{ value: 'Capital inicial', position: 'insideTopLeft', fontSize: 12, fill: 'var(--text-secondary)' }} />
            <Area type="monotone" dataKey="total" stroke="none" fill="var(--accent)" fillOpacity={0.08} isAnimationActive={false} baseValue={min - pad} />
            <Line type="monotone" dataKey="total" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} name="Valor total" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p id={`${id}-summary`} className="small muted" style={{ marginTop: '0.5rem' }}>
        De {f.date(points[0].date)} a {f.date(last.date)}: de {f.money(points[0].total)} para {f.money(last.total)}
        {' '}({f.signedMoney(last.total - initialCapital)} face ao capital inicial). Valor dado pela SAXO no fim de cada sessão; conta de simulação.
      </p>
    </>
  );
}
