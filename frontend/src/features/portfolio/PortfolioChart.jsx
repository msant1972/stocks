import { useId } from 'react';
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as f from '../../lib/format.js';
import { signedPct } from './format.js';

function CurveTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card" style={{ padding: '0.5rem 0.75rem', boxShadow: 'var(--shadow-overlay)', minWidth: '12rem' }}>
      <div className="small muted">{f.date(p.date)}</div>
      <div className="num" style={{ fontWeight: 600 }}>
        <span className="swatch" style={{ display: 'inline-block', background: 'var(--series-price)', marginRight: '0.5rem', verticalAlign: 'middle' }} />
        Portfolio {signedPct(p.value - 100)}
      </div>
      {p.benchmark != null && (
        <div className="num small">
          <span className="swatch" style={{ display: 'inline-block', background: 'var(--text-secondary)', marginRight: '0.5rem', verticalAlign: 'middle' }} />
          Catálogo {signedPct(p.benchmark - 100)}
        </div>
      )}
    </div>
  );
}

/** Valor do Portfolio Recomendado e do catálogo em partes iguais, em base 100 no início da janela; uma leitura por semana. */
export default function PortfolioChart({ curve }) {
  const id = useId();
  const last = curve.at(-1);
  return (
    <>
      <div className="legend-chips" style={{ margin: '0.75rem 0 0.25rem' }}>
        <span className="legend-chip static"><span className="swatch" style={{ background: 'var(--series-price)' }} />Portfolio Recomendado</span>
        <span className="legend-chip static"><span className="swatch" style={{ background: 'var(--text-secondary)' }} />Catálogo em partes iguais</span>
      </div>
      <div className="chart-box" role="img" aria-labelledby={`${id}-summary`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={f.shortDate} minTickGap={40} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
            <YAxis width={56} domain={['auto', 'auto']} tickFormatter={(v) => v.toLocaleString('pt-PT', { maximumFractionDigits: 0 })}
              tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
            <Tooltip content={<CurveTooltip />} />
            <ReferenceLine y={100} stroke="var(--text-secondary)" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="benchmark" stroke="var(--text-secondary)" strokeWidth={1.5} dot={false} isAnimationActive={false} name="Catálogo em partes iguais" />
            <Line type="monotone" dataKey="value" stroke="var(--series-price)" strokeWidth={2} dot={false} isAnimationActive={false} name="Portfolio Recomendado" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p id={`${id}-summary`} className="small muted" style={{ marginTop: '0.5rem' }}>
        Base 100 em {f.date(curve[0].date)}. Em {f.date(last.date)}: Portfolio {signedPct(last.value - 100)}
        {last.benchmark != null && <>; catálogo em partes iguais {signedPct(last.benchmark - 100)}</>}.
      </p>
    </>
  );
}
