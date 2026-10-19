import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Field, Notice, Switch } from '../../components/ui/controls.jsx';

// O gráfico de profundidade (Recharts) só é carregado quando há livro para mostrar.
const DepthChart = lazy(() => import('./DepthChart.jsx'));

const REFRESH_MS = 30_000; // mínimo da especificação (§6.1)

/** Casas decimais do preço: o máximo observado no livro, com mínimo de 2 (especificação §7.1). */
function pricePlaces(book) {
  return Math.max(2, ...[...book.bids, ...book.asks].map((l) => (l.price.split('.')[1] ?? '').length));
}

function stampLocal(iso) {
  return iso ? f.dateTime(iso) : '—';
}

function BookTable({ book, stats, places }) {
  const fmt = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: places, maximumFractionDigits: places });
  const qty = new Intl.NumberFormat('pt-PT', { useGrouping: 'always' });
  const rows = Math.max(book.bids.length, book.asks.length);
  return (
    <div className="table-wrap" tabIndex={0} aria-label="Livro de ofertas">
      <table className="data orderbook-table">
        <thead>
          <tr>
            <th scope="col" className="r">#</th>
            <th scope="col" className="r">Qtd compra</th>
            <th scope="col" className="r">Compra</th>
            <th scope="col" className="ob-sep">Venda</th>
            <th scope="col" className="r">Qtd venda</th>
            <th scope="col" className="r">#</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => {
            const b = book.bids[i];
            const a = book.asks[i];
            return (
              <tr key={i}>
                <td className="r muted">{b?.orders ?? ''}</td>
                <td className="r">{b ? qty.format(b.quantity) : ''}</td>
                <td className="r positive" style={{ fontWeight: i === 0 ? 600 : 400 }}>{b ? fmt.format(Number(b.price)) : ''}</td>
                <td className="ob-sep negative num" style={{ fontWeight: i === 0 ? 600 : 400 }}>{a ? fmt.format(Number(a.price)) : ''}</td>
                <td className="r">{a ? qty.format(a.quantity) : ''}</td>
                <td className="r muted">{a?.orders ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="r">{stats.bidOrders ?? ''}</td>
            <td className="r">{qty.format(stats.bidVolume)}</td>
            <td className="r muted small">Total</td>
            <td className="ob-sep muted small">Total</td>
            <td className="r">{qty.format(stats.askVolume)}</td>
            <td className="r">{stats.askOrders ?? ''}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Stat({ label, value, hint, tone }) {
  return (
    <div>
      <p className="stat-label">{label}</p>
      <p className={`stat-value ${tone ?? ''}`}>{value}</p>
      {hint && <p className="small muted">{hint}</p>}
    </div>
  );
}

/** Livro de ofertas Euronext de um instrumento do catálogo (docs/arquitectura/orderbook-spec.md, §7.3). */
export default function OrderbookPage() {
  const [params, setParams] = useSearchParams();
  const [auto, setAuto] = useState(true);
  const list = useQuery({ queryKey: ['instruments', 'with-isin-mic'], queryFn: () => api.get('/instruments?withIsinMic=true&limit=500') });
  const options = list.data?.items ?? [];
  const selected = params.get('instrumento') ?? (options[0] ? String(options[0].id) : '');

  const ob = useQuery({
    queryKey: ['orderbook', selected],
    queryFn: () => api.get(`/instruments/${selected}/orderbook`),
    enabled: Boolean(selected),
    refetchInterval: auto ? REFRESH_MS : false,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => (prev?.instrument && String(prev.instrument.id) === selected ? prev : undefined),
    staleTime: REFRESH_MS,
    retry: 1,
  });
  const data = ob.data;
  const places = useMemo(() => (data ? pricePlaces(data.book) : 2), [data]);
  const fmtPrice = (v) => (v == null ? '—' : new Intl.NumberFormat('pt-PT', { minimumFractionDigits: places, maximumFractionDigits: places }).format(Number(v)));
  const stale = ob.isError && data; // erro numa actualização: mantêm-se os dados anteriores
  const empty = data && data.book.bids.length === 0 && data.book.asks.length === 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Orderbook</h1>
          <p className="page-sub">Livro de ofertas Euronext com 15 minutos de atraso. Os pedidos à Euronext são feitos pelo servidor.</p>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: '16rem' }}>
            <Field label="Instrumento">
              {(p) => (
                <select {...p} className="select" value={selected} disabled={!options.length}
                  onChange={(e) => setParams({ instrumento: e.target.value }, { replace: true })} style={{ minHeight: '2.75rem' }}>
                  {options.map((i) => <option key={i.id} value={i.id}>{i.symbol}{i.name ? ` — ${i.name}` : ''}</option>)}
                </select>
              )}
            </Field>
          </div>
          <div className="row" style={{ gap: 8, minHeight: '2.75rem' }}>
            <Switch checked={auto} onChange={setAuto} label="Actualizar automaticamente a cada 30 segundos" />
            <span className="small">Actualizar a cada 30 s</span>
          </div>
        </div>
      </div>

      {list.isPending ? <Loading /> : list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : options.length === 0 ? (
        <section className="card">
          <EmptyState title="Nenhum instrumento com ISIN-MIC" action={<Link className="button" to="/acompanhar">Ir para Acompanhar</Link>}>
            Defina o ISIN-MIC (ex.: PTFCP0AM0008-XLIS) dos instrumentos Euronext no catálogo partilhado, em Acompanhar.
          </EmptyState>
        </section>
      ) : (
        <div className="stack">
          {ob.isPending && !data ? <section className="card"><Loading rows={8} /></section> : ob.error && !data ? (
            <section className="card"><ErrorState error={ob.error} onRetry={ob.refetch} /></section>
          ) : data && (
            <>
              <section className="card" aria-labelledby="ob-title">
                <div className="card-head">
                  <div>
                    <h2 id="ob-title" className="card-title">
                      <Link to={`/instrumentos/${data.instrument.id}`} className="row-link">{data.instrument.symbol}</Link>
                      <span className="muted" style={{ fontWeight: 400 }}> · {data.instrument.isinMic}</span>
                    </h2>
                    <p className="small muted">
                      Actualizado na Euronext: {stampLocal(data.book.updatedAt)} (atraso {data.book.delayMinutes} min)
                      {' · '}pedido às {stampLocal(data.book.fetchedAt)}
                      {ob.isFetching && <span aria-live="polite"> · a actualizar…</span>}
                    </p>
                  </div>
                </div>
                {stale && <Notice tone="warning">Não foi possível actualizar ({ob.error.message}); a mostrar os últimos dados obtidos.</Notice>}
                {data.stats.crossed && <Notice tone="warning">LIVRO CRUZADO (provável leilão): a melhor compra é igual ou superior à melhor venda.</Notice>}
                {empty ? (
                  <EmptyState title={`Sem ofertas disponíveis para ${data.instrument.isinMic}.`}>
                    O mercado pode estar fechado, o instrumento suspenso ou sem ordens.
                  </EmptyState>
                ) : (
                  <div className="stats" style={{ marginTop: stale || data.stats.crossed ? '1rem' : 0 }}>
                    <Stat label="Melhor compra" value={fmtPrice(data.stats.bestBid)} tone="positive" />
                    <Stat label="Melhor venda" value={fmtPrice(data.stats.bestAsk)} tone="negative" />
                    <Stat label="Spread" value={fmtPrice(data.stats.spread)}
                      hint={data.stats.spreadPct == null ? null : `${f.number(data.stats.spreadPct * 100)} % do mid`} />
                    <Stat label="Mid" value={fmtPrice(data.stats.mid)} />
                    <Stat label="Desequilíbrio" value={data.stats.imbalance == null ? '—' : f.number(data.stats.imbalance).replace('-', '−')}
                      hint={data.stats.imbalance == null ? null : data.stats.imbalance > 0.1 ? 'pressão compradora' : data.stats.imbalance < -0.1 ? 'pressão vendedora' : 'equilibrado'} />
                  </div>
                )}
              </section>

              {!empty && (
                <div className="grid">
                  <section className="card span-6" aria-labelledby="ob-table-title">
                    <h2 id="ob-table-title" className="card-title" style={{ marginBottom: '0.75rem' }}>Ofertas</h2>
                    <BookTable book={data.book} stats={data.stats} places={places} />
                  </section>
                  <section className="card span-6" aria-labelledby="ob-depth-title">
                    <h2 id="ob-depth-title" className="card-title" style={{ marginBottom: '0.75rem' }}>Profundidade acumulada</h2>
                    <Suspense fallback={<Loading rows={6} label="A carregar o gráfico…" />}>
                      <DepthChart book={data.book} stats={data.stats} places={places} />
                    </Suspense>
                  </section>
                </div>
              )}
            </>
          )}
          <p className="small muted">
            Fonte: Euronext, atraso 15 min. Dados propriedade da Euronext, sujeitos aos{' '}
            <a href="https://www.euronext.com/terms-use" target="_blank" rel="noreferrer">termos de uso</a>; não são cotações em tempo real.
          </p>
        </div>
      )}
    </>
  );
}
