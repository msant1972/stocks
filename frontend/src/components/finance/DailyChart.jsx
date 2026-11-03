import { useId, useMemo, useState } from 'react';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as f from '../../lib/format.js';
import { adjustedOhlc } from '../../lib/candles.js';
import { momentum, niceTicks } from '../../lib/momentum.js';
import { getStrategy } from '../../lib/strategy.js';
import StrategyPanel from './StrategyPanel.jsx';
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
const MOMENTUM_KEY = 'stocks.momentum';
const RANGE_KEY = 'stocks.periodo';
const TYPE_KEY = 'stocks.tipoGrafico';
const VOLUME_KEY = 'stocks.volume';
const TYPES = [{ value: 'linha', label: 'Linha' }, { value: 'velas', label: 'Velas' }];

/** Último período escolhido no gráfico (guardado no browser); 1A por omissão. */
function readRange() {
  try {
    const saved = localStorage.getItem(RANGE_KEY);
    return RANGES.some((r) => r.value === saved) ? saved : '1A';
  } catch { return '1A'; }
}

function readType() {
  try { return localStorage.getItem(TYPE_KEY) === 'velas' ? 'velas' : 'linha'; } catch { return 'linha'; }
}

function readVolume() {
  try { return localStorage.getItem(VOLUME_KEY) !== 'off'; } catch { return true; }
}

function readMomentum() {
  try { return localStorage.getItem(MOMENTUM_KEY) !== 'off'; } catch { return true; }
}

const pctLabel = (v) => (v == null ? '—' : f.pct(v.toFixed(2)));
const trendLabel = (rising) => (rising ? 'a subir' : 'a descer');

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

function ChartTooltip({ active, payload, currency, selected, candles }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card" style={{ padding: '0.5rem 0.75rem', boxShadow: 'var(--shadow-overlay)', minWidth: '11rem' }}>
      <div className="small muted">{f.date(p.date)}</div>
      {candles && [['Abertura', p.o], ['Máximo', p.h], ['Mínimo', p.l]].map(([label, v]) => (
        <div key={label} className="spread small" style={{ gap: '1rem' }}><span>{label}</span><span className="num">{f.price(v, currency)}</span></div>
      ))}
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

function VolumeTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card" style={{ padding: '0.5rem 0.75rem', boxShadow: 'var(--shadow-overlay)' }}>
      <div className="small muted">{f.date(p.date)}</div>
      <div className="num" style={{ fontWeight: 600 }}>{p.volume == null ? '—' : f.quantity(p.volume)}</div>
      <div className="small muted">acções negociadas</div>
    </div>
  );
}

/** Vela: pavio do mínimo ao máximo e corpo da abertura ao fecho; sobe = corpo vazio (verde), desce = corpo cheio (vermelho). */
function Candle({ x, y, width, height, payload }) {
  if (x == null || y == null || !width || !payload) return null;
  const { o, c, h, l } = payload;
  const up = c >= o;
  const color = up ? 'var(--heat-up)' : 'var(--heat-down)';
  const span = h - l;
  const px = (v) => (span > 0 ? y + ((h - v) / span) * height : y + height / 2);
  const top = px(Math.max(o, c));
  const bottom = px(Math.min(o, c));
  const cx = x + width / 2;
  const bodyWidth = Math.max(1.5, width * 0.7);
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + Math.max(height, 1)} stroke={color} strokeWidth={1.25} />
      <rect x={cx - bodyWidth / 2} y={top} width={bodyWidth} height={Math.max(1.5, bottom - top)} fill={up ? 'var(--surface)' : color} stroke={color} strokeWidth={1.25} />
    </g>
  );
}

function MomentumTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card" style={{ padding: '0.5rem 0.75rem', boxShadow: 'var(--shadow-overlay)', minWidth: '12rem' }}>
      <div className="small muted">{f.date(p.date)}</div>
      <div className="spread small" style={{ gap: '1rem' }}>
        <span className="row" style={{ gap: 6 }}>
          <span className="swatch" style={{ background: p.rising ? 'var(--positive)' : 'var(--negative)', height: 8 }} />SMA10/SMA200
        </span>
        <span className="num">{pctLabel(p.wave)}{p.wave != null && <span className="muted"> · {trendLabel(p.rising)}</span>}</span>
      </div>
      <div className="spread small" style={{ gap: '1rem' }}>
        <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: 'var(--series-price)' }} />SMA8/SMA125</span>
        <span className="num">{pctLabel(p.wave125)}</span>
      </div>
    </div>
  );
}

const MARKER = {
  buy: { letter: 'C', color: 'var(--positive)', up: true },
  add: { letter: 'R', color: 'var(--accent)', up: true },
  sell: { letter: 'V', color: 'var(--negative)', up: false },
};

/** Marcador de operação da estratégia: triângulo com letra (C compra, R reforço, V venda), não só cor. */
function SignalMarker({ cx, cy, side }) {
  if (cx == null || cy == null) return null;
  const { letter, color, up: buy } = MARKER[side];
  const tip = buy ? cy + 6 : cy - 6;
  const base = buy ? cy + 22 : cy - 22;
  return (
    <g>
      <path d={`M${cx},${tip} L${cx - 8},${base} L${cx + 8},${base} Z`} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
      <text x={cx} y={buy ? base + 13 : base - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}>{letter}</text>
    </g>
  );
}

/**
 * Gráfico diário com o fecho ajustado (comparável ao longo do tempo, apesar de dividendos e
 * desdobramentos) e, opcionalmente, médias móveis sobre a mesma escala. Inclui resumo textual e
 * alternativa em tabela.
 */
/** strategy: id de uma estratégia do registo (shared/strategies/) ou null. */
export default function DailyChart({ quotes, currency, symbol, strategy = null }) {
  const [range, setRangeState] = useState(readRange);
  const setRange = (value) => {
    setRangeState(value);
    try { localStorage.setItem(RANGE_KEY, value); } catch { /* só nesta sessão */ }
  };
  const [selected, setSelected] = useState(readSelection);
  const [showTable, setShowTable] = useState(false);
  const [showMomentum, setShowMomentum] = useState(readMomentum);
  const [type, setTypeState] = useState(readType);
  const [showVolume, setShowVolume] = useState(readVolume);
  const tableId = useId();
  const candles = type === 'velas';
  const setType = (value) => {
    setTypeState(value);
    try { localStorage.setItem(TYPE_KEY, value); } catch { /* só nesta sessão */ }
  };
  const toggleVolume = () => {
    setShowVolume((v) => {
      try { localStorage.setItem(VOLUME_KEY, v ? 'off' : 'on'); } catch { /* só nesta sessão */ }
      return !v;
    });
  };

  const toggle = (key) => {
    setSelected((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* só nesta sessão */ }
      return next;
    });
  };

  const toggleMomentum = () => {
    setShowMomentum((v) => {
      try { localStorage.setItem(MOMENTUM_KEY, v ? 'off' : 'on'); } catch { /* só nesta sessão */ }
      return !v;
    });
  };

  // O momento é calculado sobre todo o histórico carregado e só depois recortado ao período.
  const mom = useMemo(() => momentum(quotes), [quotes]);
  const strat = getStrategy(strategy);
  // A estratégia actua nos últimos windowYears anos; o histórico anterior (se houver) serve de aquecimento.
  const strategyResult = useMemo(
    () => (strat && quotes.length ? strat.run(quotes, { mom, from: f.yearsBefore(quotes.at(-1).date, strat.windowYears) }) : null),
    [strat, quotes, mom],
  );
  // Stop da posição aberta (preço real) convertido para a escala do gráfico (fecho ajustado).
  const lastQuote = quotes.at(-1);
  const stopLevel = strategyResult?.open?.stop != null && lastQuote
    ? strategyResult.open.stop * (Number(lastQuote.adjClose ?? lastQuote.close) / Number(lastQuote.close))
    : null;
  const data = useMemo(() => {
    if (!quotes.length) return [];
    const from = cutoff(quotes.at(-1).date, RANGES.find((r) => r.value === range).months);
    return quotes
      .map((q, idx) => ({
        date: q.date, value: Number(q.adjClose ?? q.close), close: q.close, volume: q.volume,
        ...(({ o, c, h, l }) => ({ o, c, h, l, range: [l, h] }))(adjustedOhlc(q)),
        ...Object.fromEntries(INDICATORS.map((i) => [i.key, num(q[i.key])])),
        ...mom[idx],
      }))
      .filter((d) => d.date >= from);
  }, [quotes, range, mom]);

  if (!data.length) return null;
  const visible = INDICATORS.filter((i) => selected.includes(i.key));
  const first = data[0];
  const last = data.at(-1);
  const change = first.value ? ((last.value - first.value) / first.value) * 100 : null;
  const prices = data.map((d) => d.value);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // A escala inclui as médias visíveis (e os máximos e mínimos, nas velas), para nada ficar cortado.
  const plotted = [...(candles ? data.flatMap((d) => [d.h, d.l]) : prices), ...visible.flatMap((i) => data.map((d) => d[i.key]).filter((v) => v != null))];
  const lo = Math.min(...plotted);
  const hi = Math.max(...plotted);
  const pad = (hi - lo) * 0.08 || hi * 0.02;
  const coverageStart = quotes[0].date;
  const requestedStart = cutoff(quotes.at(-1).date, RANGES.find((r) => r.value === range).months);
  // Indicadores sem valor no início do período (histórico insuficiente para a janela).
  const momentumTicks = niceTicks(data.flatMap((d) => [d.wave, d.wave125]));
  const partial = visible
    .map((i) => ({ ...i, firstDate: data.find((d) => d[i.key] != null)?.date }))
    .filter((i) => i.firstDate !== first.date);

  return (
    <div className="stack" style={{ gap: '1rem' }}>
      <div className="spread">
        <div className="row">
          <Segmented label="Período do gráfico" options={RANGES} value={range} onChange={setRange} />
          <Segmented label="Tipo de gráfico" options={TYPES} value={type} onChange={setType} />
        </div>
        <span className="badge">Dados diários</span>
      </div>

      <div className="legend-chips" role="group" aria-label="Indicadores no gráfico">
        <span className="legend-chip static"><span className="swatch" style={{ background: 'var(--series-price)' }} />{candles ? 'Velas (preços ajustados)' : 'Fecho ajustado'}</span>
        {INDICATORS.map((i) => (
          <button key={i.key} type="button" className="legend-chip" aria-pressed={selected.includes(i.key)} title={i.title} onClick={() => toggle(i.key)}>
            <span className="swatch" style={{ background: i.color }} />{i.label}
          </button>
        ))}
        <button type="button" className="legend-chip" aria-pressed={showVolume} onClick={toggleVolume} title="Volume negociado por sessão, por baixo do preço">
          <span className="swatch" style={{ background: 'var(--control-border)', height: 8 }} />Volume
        </button>
        <button type="button" className="legend-chip" aria-pressed={showMomentum} onClick={toggleMomentum}
          title="Gráfico de momento por baixo do histórico: SMA10/SMA200 e SMA8/SMA125">
          <span className="swatch" style={{ background: 'var(--positive)', height: 8 }} />Momento
        </button>
      </div>

      <p className="small muted" id={`${tableId}-summary`}>
        {symbol}: de {f.price(first.value, currency)} em {f.date(first.date)} para {f.price(last.value, currency)} em {f.date(last.date)}
        {change != null && <> ({f.pct(change.toFixed(2))})</>}. Mínimo {f.price(min, currency)}, máximo {f.price(max, currency)}.
        {coverageStart > requestedStart && <> Dados disponíveis apenas desde {f.date(coverageStart)}.</>}
        {visible.map((i) => last[i.key] != null && <span key={i.key}> {i.label} em {f.price(last[i.key], currency)}.</span>)}
        {showMomentum && last.wave != null && <> Momento SMA10/SMA200 em {pctLabel(last.wave)} ({trendLabel(last.rising)}).</>}
      </p>

      <div className="chart-box" role="img" aria-labelledby={`${tableId}-summary`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} syncId="historico" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
            <Tooltip content={<ChartTooltip currency={currency} selected={selected} candles={candles} />} cursor={{ stroke: 'var(--control-border)' }} />
            {candles
              ? <Bar dataKey="range" shape={<Candle />} maxBarSize={14} isAnimationActive={false} />
              : <Area type="linear" dataKey="value" stroke="var(--series-price)" strokeWidth={2} fill="url(#chartFill)" isAnimationActive={false} />}
            {visible.map((i) => (
              <Line key={i.key} type="linear" dataKey={i.key} stroke={i.color} strokeWidth={1.75} dot={false}
                activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
            ))}
            {stopLevel != null && (
              <ReferenceLine y={stopLevel} stroke="var(--negative)" strokeDasharray="5 4" ifOverflow="extendDomain"
                label={{ value: 'Stop', position: 'insideBottomRight', fill: 'var(--negative)', fontSize: 12 }} />
            )}
            {strategyResult?.signals.filter((s) => s.date >= first.date).map((s) => {
              const point = data.find((d) => d.date === s.date);
              return point && (
                <ReferenceDot key={`${s.side}-${s.date}-${s.reason ?? ''}`} x={s.date} y={point.value} r={0} ifOverflow="extendDomain"
                  shape={(props) => <SignalMarker {...props} side={s.side} />} />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {showVolume && (
        <div className="chart-volume" role="img"
          aria-label={`Volume de ${symbol}: ${last.volume == null ? 'sem dados' : `${f.quantity(last.volume)} acções na última sessão`}.`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} syncId="historico" barCategoryGap={0} barGap={0} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis width={64} tickLine={false} axisLine={false} tickCount={3} tickFormatter={f.compact} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
              <Tooltip content={<VolumeTooltip />} cursor={{ stroke: 'var(--control-border)' }} />
              <Bar dataKey="volume" isAnimationActive={false}>
                {data.map((d) => <Cell key={d.date} fill={d.c >= d.o ? 'var(--heat-up)' : 'var(--heat-down)'} fillOpacity={0.45} />)}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {showMomentum && (
        <section aria-labelledby={`${tableId}-mom`} className="stack" style={{ gap: '0.5rem' }}>
          <div className="row small" style={{ gap: '1rem' }}>
            <h3 id={`${tableId}-mom`} style={{ fontSize: '0.9375rem', fontWeight: 600 }}>Momento</h3>
            <span className="row" style={{ gap: 6 }}>
              <span className="swatch" style={{ background: last.rising ? 'var(--positive)' : 'var(--negative)', height: 8 }} />
              SMA10/SMA200 <span className="num" style={{ fontWeight: 600 }}>{pctLabel(last.wave)}</span>
              {last.wave != null && <span className="muted">({trendLabel(last.rising)})</span>}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <span className="swatch" style={{ background: 'var(--series-price)' }} />
              SMA8/SMA125 <span className="num" style={{ fontWeight: 600 }}>{pctLabel(last.wave125)}</span>
            </span>
          </div>
          <div className="chart-box-small" role="img"
            aria-label={`Momento de ${symbol}: SMA10/SMA200 em ${pctLabel(last.wave)}, ${trendLabel(last.rising)}; SMA8/SMA125 em ${pctLabel(last.wave125)}.`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} syncId="historico" barCategoryGap={0} barGap={0} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={f.shortDate} minTickGap={48} tickLine={false} axisLine={false}
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                <YAxis width={64} tickLine={false} axisLine={false} ticks={momentumTicks}
                  domain={[momentumTicks[0], momentumTicks.at(-1)]} interval={0}
                  tickFormatter={(v) => `${f.number(v).replace(/,00$/, '')}%`} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                <Tooltip content={<MomentumTooltip />} cursor={{ stroke: 'var(--control-border)' }} />
                <Bar dataKey="wave" isAnimationActive={false}>
                  {data.map((d) => (
                    <Cell key={d.date} fill={d.rising ? 'var(--positive)' : 'var(--negative)'} fillOpacity={0.3} />
                  ))}
                </Bar>
                <ReferenceLine y={0} stroke="var(--control-border)" strokeWidth={3} />
                <Line type="linear" dataKey="wave125" stroke="var(--series-price)" strokeWidth={1.5} dot={false}
                  activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="small muted">
            Área: SMA10/SMA200 − 1, verde quando sobe face às duas sessões anteriores e vermelha caso contrário.
            Linha: SMA8/SMA125 − 1. Em percentagem, sobre o fecho ajustado.
          </p>
        </section>
      )}

      {strategyResult && <StrategyPanel strategy={strat} result={strategyResult} currency={currency || 'EUR'} symbol={symbol} />}

      <p className="small muted">
        Eixo vertical em {currency || 'EUR'} ({candles ? 'preços ajustados; vela vazia a verde = fechou acima da abertura, cheia a vermelho = abaixo' : 'fecho ajustado'}); a escala não começa em zero. As médias são calculadas sobre o fecho ajustado.
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
                  <th scope="col" className="r">Volume</th>
                  {visible.map((i) => <th key={i.key} scope="col" className="r">{i.label}</th>)}
                  {showMomentum && <><th scope="col" className="r">SMA10/SMA200</th><th scope="col" className="r">SMA8/SMA125</th></>}
                </tr>
              </thead>
              <tbody>
                {[...data].reverse().map((d) => (
                  <tr key={d.date}>
                    <td>{f.date(d.date)}</td>
                    <td className="r">{f.price(d.close, currency)}</td>
                    <td className="r">{f.price(d.value, currency)}</td>
                    <td className="r">{d.volume == null ? '—' : f.quantity(d.volume)}</td>
                    {visible.map((i) => <td key={i.key} className="r">{d[i.key] == null ? '—' : f.price(d[i.key], currency)}</td>)}
                    {showMomentum && (
                      <>
                        <td className="r">{pctLabel(d.wave)}{d.wave != null && <span className="small muted"> {trendLabel(d.rising)}</span>}</td>
                        <td className="r">{pctLabel(d.wave125)}</td>
                      </>
                    )}
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
