import { useId, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as f from '../../lib/format.js';
import { Button, Segmented } from '../ui/controls.jsx';

const RANGES = [
  { value: '1M', label: '1M', months: 1 },
  { value: '3M', label: '3M', months: 3 },
  { value: '6M', label: '6M', months: 6 },
  { value: '1A', label: '1A', months: 12 },
  { value: '2A', label: '2A', months: 24 },
];

function cutoff(lastDate, months) {
  const [y, m, d] = lastDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 - months, d));
  return t.toISOString().slice(0, 10);
}

function ChartTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card" style={{ padding: '0.5rem 0.75rem', boxShadow: 'var(--shadow-overlay)' }}>
      <div className="small muted">{f.date(p.date)}</div>
      <div className="num" style={{ fontWeight: 600 }}>{f.price(p.value, currency)}</div>
    </div>
  );
}

/**
 * Gráfico diário com o fecho ajustado (comparável ao longo do tempo, apesar de dividendos e
 * desdobramentos). Inclui resumo textual e alternativa em tabela.
 */
export default function DailyChart({ quotes, currency, symbol }) {
  const [range, setRange] = useState('1A');
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const data = useMemo(() => {
    if (!quotes.length) return [];
    const from = cutoff(quotes.at(-1).date, RANGES.find((r) => r.value === range).months);
    return quotes
      .filter((q) => q.date >= from)
      .map((q) => ({ date: q.date, value: Number(q.adjClose ?? q.close), close: q.close }));
  }, [quotes, range]);

  if (!data.length) return null;
  const first = data[0];
  const last = data.at(-1);
  const change = first.value ? ((last.value - first.value) / first.value) * 100 : null;
  const min = Math.min(...data.map((d) => d.value));
  const max = Math.max(...data.map((d) => d.value));
  const pad = (max - min) * 0.08 || max * 0.02;
  const coverageStart = quotes[0].date;
  const requestedStart = cutoff(quotes.at(-1).date, RANGES.find((r) => r.value === range).months);

  return (
    <div className="stack" style={{ gap: '1rem' }}>
      <div className="spread">
        <Segmented label="Período do gráfico" options={RANGES} value={range} onChange={setRange} />
        <span className="badge">Dados diários</span>
      </div>

      <p className="small muted" id={`${tableId}-summary`}>
        {symbol}: de {f.price(first.value, currency)} em {f.date(first.date)} para {f.price(last.value, currency)} em {f.date(last.date)}
        {change != null && <> ({f.pct(change.toFixed(2))})</>}. Mínimo {f.price(min, currency)}, máximo {f.price(max, currency)}.
        {coverageStart > requestedStart && <> Dados disponíveis apenas desde {f.date(coverageStart)}.</>}
      </p>

      <div className="chart-box" role="img" aria-labelledby={`${tableId}-summary`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date" tickFormatter={f.shortDate} minTickGap={48} tickLine={false} axisLine={false}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            />
            <YAxis
              domain={[min - pad, max + pad]} width={64} tickLine={false} axisLine={false}
              tickFormatter={(v) => f.number(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            />
            <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ stroke: 'var(--control-border)' }} />
            <Area type="linear" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="url(#chartFill)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="small muted">Eixo vertical em {currency || 'EUR'} (fecho ajustado); a escala não começa em zero.</p>

      <div>
        <Button size="small" variant="ghost" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Ocultar tabela de dados' : 'Ver dados em tabela'}
        </Button>
        {showTable && (
          <div id={tableId} className="table-wrap" tabIndex={0} style={{ maxHeight: 320, overflowY: 'auto', marginTop: 8 }}>
            <table className="data">
              <caption className="visually-hidden">Fechos diários de {symbol}</caption>
              <thead><tr><th scope="col">Sessão</th><th scope="col" className="r">Fecho</th><th scope="col" className="r">Fecho ajustado</th></tr></thead>
              <tbody>
                {[...data].reverse().map((d) => (
                  <tr key={d.date}><td>{f.date(d.date)}</td><td className="r">{f.price(d.close, currency)}</td><td className="r">{f.price(d.value, currency)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
