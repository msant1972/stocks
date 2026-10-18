import { useId, useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as f from '../../lib/format.js';
import { Button, Segmented } from '../ui/controls.jsx';

const RANGES = [
  { value: '1M', label: '1M', months: 1 },
  { value: '3M', label: '3M', months: 3 },
  { value: '6M', label: '6M', months: 6 },
  { value: '1A', label: '1A', months: 12 },
  { value: '2A', label: '2A', months: 24 },
];

// Ordem fixa (cores validadas por esta ordem); calculados na BD sobre o fecho ajustado.
export const INDICATORS = [
  { key: 'ema9', label: 'EMA9', title: 'Média móvel exponencial de 9 sessões', color: 'var(--series-ema9)' },
  { key: 'sma10', label: 'SMA10', title: 'Média móvel simples de 10 sessões', color: 'var(--series-sma10)' },
  { key: 'sma50', label: 'SMA50', title: 'Média móvel simples de 50 sessões', color: 'var(--series-sma50)' },
  { key: 'sma125', label: 'SMA125', title: 'Média móvel simples de 125 sessões', color: 'var(--series-sma125)' },
  { key: 'sma200', label: 'SMA200', title: 'Média móvel simples de 200 sessões', color: 'var(--series-sma200)' },
];

const STORAGE_KEY = 'stocks.indicators';

function readSelection() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return INDICATORS.map((i) => i.key).filter((k) => saved.includes(k));
  } catch {
    return [];
  }
}

function cutoff(lastDate, months) {
  const [y, m, d] = lastDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 - months, d));
  return t.toISOString().slice(0, 10);
}

const num = (v) => (v == null ? null : Number(v));

function ChartTooltip({ active, payload, currency, selected }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card" style={{ padding: '0.5rem 0.75rem', boxShadow: 'var(--shadow-overlay)', minWidth: '11rem' }}>
      <div className="small muted">{f.date(p.date)}</div>
      <div className="spread" style={{ gap: '1rem' }}>
        <span className="row small" style={{ gap: 6 }}><span className="swatch" style={{ background: 'var(--series-price)' }} />Fecho aj.</span>
        <span className="num" style={{ fontWeight: 600 }}>{f.price(p.value, currency)}</span>
      </div>
      {INDICATORS.filter((i) => selected.includes(i.key)).map((i) => (
        <div key={i.key} className="spread small" style={{ gap: '1rem' }}>
          <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: i.color }} />{i.label}</span>
          <span className="num">{p[i.key] == null ? '—' : f.price(p[i.key], currency)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Gráfico diário com o fecho ajustado (comparável ao longo do tempo, apesar de dividendos e
 * desdobramentos) e, opcionalmente, médias móveis sobre a mesma escala. Inclui resumo textual e
 * alternativa em tabela.
 */
export default function DailyChart({ quotes, currency, symbol }) {
  const [range, setRange] = useState('1A');
  const [selected, setSelected] = useState(readSelection);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const toggle = (key) => {
    setSelected((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* só nesta sessão */ }
      return next;
    });
  };

  const data = useMemo(() => {
    if (!quotes.length) return [];
    const from = cutoff(quotes.at(-1).date, RANGES.find((r) => r.value === range).months);
    return quotes
      .filter((q) => q.date >= from)
      .map((q) => ({
        date: q.date, value: Number(q.adjClose ?? q.close), close: q.close,
        ...Object.fromEntries(INDICATORS.map((i) => [i.key, num(q[i.key])])),
      }));
  }, [quotes, range]);

  if (!data.length) return null;
  const visible = INDICATORS.filter((i) => selected.includes(i.key));
  const first = data[0];
  const last = data.at(-1);
  const change = first.value ? ((last.value - first.value) / first.value) * 100 : null;
  const prices = data.map((d) => d.value);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // A escala inclui as médias visíveis, para nenhuma linha ficar cortada.
  const plotted = [...prices, ...visible.flatMap((i) => data.map((d) => d[i.key]).filter((v) => v != null))];
  const lo = Math.min(...plotted);
  const hi = Math.max(...plotted);
  const pad = (hi - lo) * 0.08 || hi * 0.02;
  const coverageStart = quotes[0].date;
  const requestedStart = cutoff(quotes.at(-1).date, RANGES.find((r) => r.value === range).months);
  // Indicadores sem valor no início do período (histórico insuficiente para a janela).
  const partial = visible
    .map((i) => ({ ...i, firstDate: data.find((d) => d[i.key] != null)?.date }))
    .filter((i) => i.firstDate !== first.date);

  return (
    <div className="stack" style={{ gap: '1rem' }}>
      <div className="spread">
        <Segmented label="Período do gráfico" options={RANGES} value={range} onChange={setRange} />
        <span className="badge">Dados diários</span>
      </div>

      <div className="legend-chips" role="group" aria-label="Indicadores no gráfico">
        <span className="legend-chip static"><span className="swatch" style={{ background: 'var(--series-price)' }} />Fecho ajustado</span>
        {INDICATORS.map((i) => (
          <button key={i.key} type="button" className="legend-chip" aria-pressed={selected.includes(i.key)} title={i.title} onClick={() => toggle(i.key)}>
            <span className="swatch" style={{ background: i.color }} />{i.label}
          </button>
        ))}
      </div>

      <p className="small muted" id={`${tableId}-summary`}>
        {symbol}: de {f.price(first.value, currency)} em {f.date(first.date)} para {f.price(last.value, currency)} em {f.date(last.date)}
        {change != null && <> ({f.pct(change.toFixed(2))})</>}. Mínimo {f.price(min, currency)}, máximo {f.price(max, currency)}.
        {coverageStart > requestedStart && <> Dados disponíveis apenas desde {f.date(coverageStart)}.</>}
        {visible.map((i) => last[i.key] != null && <span key={i.key}> {i.label} em {f.price(last[i.key], currency)}.</span>)}
      </p>

      <div className="chart-box" role="img" aria-labelledby={`${tableId}-summary`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-price)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--series-price)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date" tickFormatter={f.shortDate} minTickGap={48} tickLine={false} axisLine={false}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            />
            <YAxis
              domain={[lo - pad, hi + pad]} width={64} tickLine={false} axisLine={false}
              tickFormatter={(v) => f.number(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            />
            <Tooltip content={<ChartTooltip currency={currency} selected={selected} />} cursor={{ stroke: 'var(--control-border)' }} />
            <Area type="linear" dataKey="value" stroke="var(--series-price)" strokeWidth={2} fill="url(#chartFill)" isAnimationActive={false} />
            {visible.map((i) => (
              <Line key={i.key} type="linear" dataKey={i.key} stroke={i.color} strokeWidth={1.75} dot={false}
                activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="small muted">
        Eixo vertical em {currency || 'EUR'} (fecho ajustado); a escala não começa em zero. As médias são calculadas sobre o fecho ajustado.
        {partial.map((i) => (
          <span key={i.key}> {i.label} {i.firstDate ? `disponível a partir de ${f.date(i.firstDate)}` : 'sem sessões suficientes neste período'}.</span>
        ))}
      </p>

      <div>
        <Button size="small" variant="ghost" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Ocultar tabela de dados' : 'Ver dados em tabela'}
        </Button>
        {showTable && (
          <div id={tableId} className="table-wrap" tabIndex={0} style={{ maxHeight: 320, overflowY: 'auto', marginTop: 8 }}>
            <table className="data">
              <caption className="visually-hidden">Fechos diários de {symbol}</caption>
              <thead>
                <tr>
                  <th scope="col">Sessão</th>
                  <th scope="col" className="r">Fecho</th>
                  <th scope="col" className="r">Fecho ajustado</th>
                  {visible.map((i) => <th key={i.key} scope="col" className="r">{i.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...data].reverse().map((d) => (
                  <tr key={d.date}>
                    <td>{f.date(d.date)}</td>
                    <td className="r">{f.price(d.close, currency)}</td>
                    <td className="r">{f.price(d.value, currency)}</td>
                    {visible.map((i) => <td key={i.key} className="r">{d[i.key] == null ? '—' : f.price(d[i.key], currency)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
