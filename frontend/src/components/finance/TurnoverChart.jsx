import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as f from '../../lib/format.js';
import { axisMoney, bigMoney } from '../../lib/company.js';

function Tip({ active, payload, label, countLabel }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="small muted">{f.date(p.date)}</div>
      <div><span className="swatch-inline" style={{ background: 'var(--series-price)' }} /> <strong className="num">{bigMoney(p.value)}</strong> <span className="small muted">{label}</span></div>
      {p.sma200 != null && (
        <div><span className="swatch-inline" style={{ background: 'var(--series-sma200)' }} /> <span className="num">{bigMoney(p.sma200)}</span> <span className="small muted">SMA200</span></div>
      )}
      <div className="small muted">{p.instruments} {countLabel}</div>
    </div>
  );
}

/**
 * Série diária do catálogo (valor negociado ou capitalização; linha fina) e a sua SMA200 (linha mais grossa). Um só eixo
 * em euros: as duas séries medem a mesma coisa. `zeroBased`: o eixo começa em 0 (valor negociado); sem ele ajusta-se aos
 * dados, para se verem as variações de uma série que nunca anda perto de 0 (capitalização). Legenda na página.
 */
export default function TurnoverChart({ points, label = 'valor negociado', countLabel = 'instrumentos com negócios', zeroBased = true }) {
  return (
    <div className="chart-box" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
          <XAxis dataKey="date" tickFormatter={f.shortDate} minTickGap={48} tickLine={false} axisLine={false}
            tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
          <YAxis width={zeroBased ? 56 : 72} tickFormatter={axisMoney} tickLine={false} axisLine={false}
            domain={zeroBased ? [0, 'auto'] : ['auto', 'auto']}
            tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
          <Tooltip content={<Tip label={label} countLabel={countLabel} />} cursor={{ stroke: 'var(--text-secondary)', strokeWidth: 1 }} />
          <Line type="linear" dataKey="value" stroke="var(--series-price)" strokeWidth={1.25} dot={false} isAnimationActive={false} name={label} />
          <Line type="monotone" dataKey="sma200" stroke="var(--series-sma200)" strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} name="SMA200" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
