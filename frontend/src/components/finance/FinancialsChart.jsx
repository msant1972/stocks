import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisMoney, bigMoney } from '../../lib/company.js';

const METRICS = [
  { key: 'revenue', label: 'Receitas' },
  { key: 'netIncome', label: 'Resultado líquido' },
];

function Tip({ active, payload, label, metric, currency }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="small muted">{label}</div>
      <div><strong>{bigMoney(payload[0].value, currency)}</strong> <span className="small muted">{metric}</span></div>
    </div>
  );
}

/**
 * Contas anuais em pequenos gráficos separados (receitas e resultado líquido têm escalas muito diferentes: um eixo cada,
 * nunca um eixo duplo). Uma série por gráfico, com a cor do preço; o título nomeia-a. A tabela acessível fica no painel.
 */
export default function FinancialsChart({ financials, currency }) {
  return (
    <div className="financials-grid">
      {METRICS.map((m) => {
        const data = financials.filter((r) => r[m.key] != null).map((r) => ({ year: String(r.year), value: r[m.key] }));
        if (data.length === 0) return null;
        const hasNegative = data.some((d) => d.value < 0);
        return (
          <figure key={m.key} className="financials-figure" aria-hidden="true">
            <figcaption className="small">{m.label}</figcaption>
            <div className="chart-box-small">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
                  <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                  <YAxis width={52} tickLine={false} axisLine={false} tickFormatter={axisMoney} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                  {hasNegative && <ReferenceLine y={0} stroke="var(--text-secondary)" />}
                  <Tooltip cursor={{ fill: 'var(--surface-muted)' }} content={<Tip metric={m.label} currency={currency} />} />
                  <Bar dataKey="value" fill="var(--series-price)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </figure>
        );
      })}
    </div>
  );
}
