import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisMoney, bigMoney } from '../../lib/company.js';
import { HEAT_LABELS, monthLabel } from '../../lib/turnover.js';

const fill = (m) => (m.partial ? 'var(--heat-month-partial)' : `var(--heat-month-${m.heat})`);

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="small muted">{monthLabel(m.month)}{m.partial ? ' · mês incompleto' : ''}</div>
      <div><strong className="num">{bigMoney(m.value)}</strong> <span className="small muted">em {m.sessions} sessões</span></div>
      <div className="small muted">média de {bigMoney(m.perSession)} por sessão</div>
      {!m.partial && <div className="small">{HEAT_LABELS[m.heat - 1]} · {m.rank}.º mais quente</div>}
    </div>
  );
}

/** Rótulo só por cima dos 3 meses mais quentes (rótulos selectivos, não em todas as barras). */
function TopLabel({ x, y, width, index, data }) {
  const m = data[index];
  if (!m || m.rank == null || m.rank > 3) return null;
  return (
    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
      {axisMoney(m.value)}
    </text>
  );
}

/**
 * Histograma do valor negociado de cada mês. A cor diz o quartil do mês entre os meses completos (escala de uma só
 * cor, do claro ao escuro); os meses incompletos ficam a cinzento. Legenda e tabela ficam na página.
 */
export default function MonthlyTurnoverChart({ months }) {
  return (
    <div className="chart-box" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={months} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
          <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m).replace('.', '')} minTickGap={8} interval="preserveStartEnd"
            tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
          <YAxis width={64} tickFormatter={axisMoney} tickLine={false} axisLine={false}
            tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
          <Tooltip content={<Tip />} cursor={{ fill: 'var(--surface-muted)' }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} stroke="var(--surface)" strokeWidth={1}>
            {months.map((m) => <Cell key={m.month} fill={fill(m)} />)}
            <LabelList dataKey="value" content={<TopLabel data={months} />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
