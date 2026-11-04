import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as f from '../../lib/format.js';

const nf = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="small muted">{f.date(d.date)}</div>
      <div><strong>{nf.format(d.pe)}×</strong> <span className="small muted">P/E</span></div>
    </div>
  );
}

/**
 * P/E diário (aprox. semanal) com a faixa habitual da empresa (1.º a 3.º quartil) e a mediana. Uma só série: o título
 * nomeia-a, sem legenda. A leitura acessível (actual, mediana e quartis) está no texto do cartão.
 */
export default function PeHistoryChart({ series, p25, p75, median }) {
  return (
    <figure className="financials-figure" aria-hidden="true" style={{ marginTop: '0.5rem' }}>
      <div className="chart-box-small">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={48} tickFormatter={(d) => d.slice(0, 4)}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
            <YAxis width={36} tickLine={false} axisLine={false} domain={['auto', 'auto']} tickFormatter={(v) => Math.round(v)}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
            <ReferenceArea y1={p25} y2={p75} fill="var(--surface-muted)" fillOpacity={1} ifOverflow="extendDomain" />
            <ReferenceLine y={median} stroke="var(--text-secondary)" strokeDasharray="4 4" />
            <Tooltip content={<Tip />} cursor={{ stroke: 'var(--text-secondary)', strokeWidth: 1 }} />
            <Line type="monotone" dataKey="pe" stroke="var(--series-price)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
