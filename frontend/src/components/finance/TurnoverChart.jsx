import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as f from '../../lib/format.js';
import { axisMoney, bigMoney } from '../../lib/company.js';

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="small muted">{f.date(p.date)}</div>
      <div><span className="swatch-inline" style={{ background: 'var(--series-price)' }} /> <strong className="num">{bigMoney(p.value)}</strong> <span className="small muted">valor negociado</span></div>
      {p.sma200 != null && (
        <div><span className="swatch-inline" style={{ background: 'var(--series-sma200)' }} /> <span className="num">{bigMoney(p.sma200)}</span> <span className="small muted">SMA200</span></div>
      )}
      <div className="small muted">{p.instruments} instrumentos com negócios</div>
    </div>
  );
}

/**
 * Valor negociado diário (linha fina, varia muito de dia para dia) e a SMA200 (linha mais grossa). Um só eixo em euros:
 * as duas séries medem a mesma coisa. Legenda e tabela ficam na página.
 */
export default function TurnoverChart({ points }) {
  return (
    <div className="chart-box" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
          <XAxis dataKey="date" tickFormatter={f.shortDate} minTickGap={48} tickLine={false} axisLine={false}
            tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
          <YAxis width={56} tickFormatter={axisMoney} tickLine={false} axisLine={false} domain={[0, 'auto']}
            tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
          <Tooltip content={<Tip />} cursor={{ stroke: 'var(--text-secondary)', strokeWidth: 1 }} />
          <Line type="linear" dataKey="value" stroke="var(--series-price)" strokeWidth={1.25} dot={false} isAnimationActive={false} name="Valor negociado" />
          <Line type="monotone" dataKey="sma200" stroke="var(--series-sma200)" strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} name="SMA200" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
