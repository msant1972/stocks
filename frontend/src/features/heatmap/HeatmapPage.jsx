import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, Tooltip, Treemap } from 'recharts';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Button, Field, Segmented } from '../../components/ui/controls.jsx';

// Só os instrumentos com maior valor negociado (preço × volume) no período.
const TOP = 20;

const PERIODS = [
  { value: '1', label: '1 dia' },
  { value: '5', label: '5 dias' },
  { value: '30', label: '30 dias' },
];

// Classes de cor: subida > +1%, descida < −1%, neutro entre os dois.
const CLASSES = {
  up: { label: 'Subida superior a 1%', color: 'var(--heat-up)' },
  flat: { label: 'Entre −1% e +1%', color: 'var(--heat-flat)' },
  down: { label: 'Descida superior a 1%', color: 'var(--heat-down)' },
};
const classOf = (pct) => (pct > 1 ? 'up' : pct < -1 ? 'down' : 'flat');

const one = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Valor negociado abreviado: «5,0 mil M€», «850,3 M€», «12 345 €». */
function tradedEur(value) {
  const v = Number(value);
  if (v >= 1e9) return `${one.format(v / 1e9)} mil M€`;
  if (v >= 1e6) return `${one.format(v / 1e6)} M€`;
  return f.money(v, 'EUR', 0);
}
const shortSymbol = (s) => s.replace(/\.[A-Z]{1,3}$/, '');

function Tile(props) {
  const { depth, x, y, width, height, symbol, changePct } = props;
  if (depth !== 1 || width <= 0 || height <= 0) return null;
  const pct = Number(changePct);
  const size = Math.max(9, Math.min(width / 5.5, height / 3.2, 26));
  const showText = width >= 34 && height >= 22;
  const showPct = height >= size * 2.4;
  return (
    <g style={{ cursor: 'pointer' }}>
      <rect x={x} y={y} width={width} height={height} fill={CLASSES[classOf(pct)].color} stroke="var(--surface)" strokeWidth={2} />
      {showText && (
        <text x={x + width / 2} y={y + height / 2} textAnchor="middle" fill="#fff" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <tspan x={x + width / 2} dy={showPct ? -size * 0.2 : size * 0.35} fontSize={size} fontWeight={600}>{shortSymbol(symbol)}</tspan>
          {showPct && <tspan x={x + width / 2} dy={size * 1.15} fontSize={size * 0.8}>{f.pct(changePct)}</tspan>}
        </text>
      )}
    </g>
  );
}

function TileTooltip({ active, payload, period }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (!p?.symbol) return null;
  return (
    <div className="card" style={{ padding: '0.625rem 0.875rem', boxShadow: 'var(--shadow-overlay)', minWidth: '13rem' }}>
      <div style={{ fontWeight: 600 }}>{p.symbol}</div>
      {p.instrumentName && <div className="small muted">{p.instrumentName}</div>}
      <dl className="summary-box" style={{ marginTop: 8, padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}>
        <dt>Variação ({period} {period === 1 ? 'sessão' : 'sessões'})</dt><dd>{f.pct(p.changePct)}</dd>
        <dt>Valor negociado</dt><dd>{tradedEur(p.tradedValue)}</dd>
        <dt>Último fecho</dt><dd>{f.price(p.close)}</dd>
        <dt>Período</dt><dd>{f.shortDate(p.fromDate)} – {f.shortDate(p.toDate)}</dd>
      </dl>
    </div>
  );
}

export default function HeatmapPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const period = PERIODS.some((p) => p.value === params.get('periodo')) ? params.get('periodo') : '5';
  const scope = params.get('lista') === '1' ? 'watchlist' : 'all';
  const [showTable, setShowTable] = useState(false);

  const setParam = (key, value, fallback) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  const q = useQuery({
    queryKey: ['heatmap', period, scope],
    queryFn: () => api.get(`/heatmap?period=${period}&scope=${scope}&limit=${TOP}`),
    placeholderData: (prev) => prev,
  });
  const items = q.data?.items ?? [];
  // O Treemap reescreve «name» com o nameKey; o nome do instrumento segue noutro campo.
  const data = items.map((i) => ({ ...i, instrumentName: i.name, size: Number(i.tradedValue) }));
  const first = items.reduce((m, i) => (!m || i.fromDate < m ? i.fromDate : m), null);
  const counts = items.reduce((c, i) => ({ ...c, [classOf(Number(i.changePct))]: (c[classOf(Number(i.changePct))] ?? 0) + 1 }), {});
  const n = Number(period);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">HeatMap</h1>
          <p className="page-sub">Variação e valor negociado de cada instrumento. Cotações diárias, não em tempo real.</p>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Segmented label="Instrumentos" value={scope} onChange={(v) => setParam('lista', v === 'watchlist' ? '1' : '0', '0')}
            options={[{ value: 'all', label: 'Todos' }, { value: 'watchlist', label: 'A minha lista' }]} />
          <div style={{ minWidth: '9rem' }}>
            <Field label="Período">
              {(p) => (
                <select {...p} className="select" value={period} onChange={(e) => setParam('periodo', e.target.value, '5')} style={{ minHeight: '2.75rem' }}>
                  {PERIODS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </Field>
          </div>
        </div>
      </div>

      <section className="card" aria-labelledby="hm-title">
        <h2 id="hm-title" className="visually-hidden">Mapa de calor</h2>
        <div className="legend-chips" style={{ marginBottom: '0.75rem' }}>
          {Object.entries(CLASSES).map(([k, c]) => (
            <span key={k} className="legend-chip static">
              <span className="swatch" style={{ background: c.color, width: 14, height: 14, borderRadius: 3 }} />
              {c.label}{q.data && <span className="muted"> ({counts[k] ?? 0})</span>}
            </span>
          ))}
        </div>
        <p className="small muted" style={{ marginBottom: '1rem' }}>
          {q.data && <><strong style={{ color: 'var(--text)' }}>Top {items.length} de {q.data.total} instrumentos</strong> por valor negociado. </>}
          Tamanho de cada quadrado: valor negociado (preço × volume) nas últimas {n === 1 ? 'sessão' : `${n} sessões`}
          {first && q.data?.latestSession && <> ({f.date(first)} a {f.date(q.data.latestSession)})</>}.
          A variação compara o último fecho ajustado com o de {n === 1 ? 'uma sessão' : `${n} sessões`} antes. Clique num quadrado para ver o instrumento.
        </p>

        {q.isPending ? <Loading rows={8} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : items.length === 0 ? (
          <EmptyState title="Sem dados para mostrar"
            action={scope === 'watchlist' ? <Link className="button" to="/acompanhar">Acompanhar instrumentos</Link> : null}>
            {scope === 'watchlist' ? 'A sua lista não tem instrumentos activos com cotações no período.' : 'Ainda não há instrumentos activos com cotações no período.'}
          </EmptyState>
        ) : (
          <div className="heatmap-box" role="img"
            aria-label={`Mapa de calor dos ${items.length} instrumentos com maior valor negociado: ${counts.up ?? 0} a subir mais de 1%, ${counts.flat ?? 0} entre −1% e +1%, ${counts.down ?? 0} a descer mais de 1%. Ver tabela para os valores.`}
            style={{ opacity: q.isFetching ? 0.6 : 1 }}>
            <ResponsiveContainer width="100%" height="100%">
              <Treemap data={data} dataKey="size" nameKey="symbol" aspectRatio={4 / 3} isAnimationActive={false}
                content={<Tile />} onClick={(node) => node?.instrumentId && navigate(`/instrumentos/${node.instrumentId}`)}>
                <Tooltip content={<TileTooltip period={n} />} />
              </Treemap>
            </ResponsiveContainer>
          </div>
        )}

        {items.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <Button size="small" variant="ghost" aria-expanded={showTable} aria-controls="hm-table" onClick={() => setShowTable((v) => !v)}>
              {showTable ? 'Ocultar tabela' : 'Ver em tabela'}
            </Button>
            {showTable && (
              <div id="hm-table" className="table-wrap" tabIndex={0} style={{ maxHeight: 420, overflowY: 'auto', marginTop: 8 }}>
                <table className="data">
                  <caption className="visually-hidden">Variação e valor negociado por instrumento</caption>
                  <thead>
                    <tr>
                      <th scope="col">Instrumento</th>
                      <th scope="col" className="r">Variação</th>
                      <th scope="col" className="r">Valor negociado</th>
                      <th scope="col" className="r">Último fecho</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const t = f.trend(i.changePct);
                      return (
                        <tr key={i.instrumentId}>
                          <td><Link to={`/instrumentos/${i.instrumentId}`} className="row-link">{i.symbol}</Link><div className="small muted">{i.name}</div></td>
                          <td className={`r ${t.tone}`}>{f.pct(i.changePct)}</td>
                          <td className="r">{tradedEur(i.tradedValue)}</td>
                          <td className="r">{f.price(i.close)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
