import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { keys, useBestStrategies, useCatalog, usePortfolio, useQuotes, useWatchlist } from '../../lib/queries.js';
import { PriceChange, QuoteDate } from '../../components/finance/finance.jsx';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Button, Segmented } from '../../components/ui/controls.jsx';
import Icon from '../../components/ui/Icon.jsx';
import StrategySelect from '../../components/finance/StrategySelect.jsx';
import { DEFAULT_STRATEGY_ID, getStrategy } from '../../lib/strategy.js';

// O gráfico (Recharts) só é carregado quando é preciso.
const DailyChart = lazy(() => import('../../components/finance/DailyChart.jsx'));

/** Início das cotações a pedir: estratégias com aquecimento precisam de histórico antes da janela em que actuam. */
const quotesFromFor = (strategyId, lastSession) => {
  const st = getStrategy(strategyId);
  return st?.warmupYears && lastSession ? f.yearsBefore(lastSession, st.windowYears + st.warmupYears) : undefined;
};

/**
 * Charts: o gráfico de um instrumento e, à direita, uma lista para passar de um instrumento a outro sem mudar de
 * página (clique, setas ↑/↓ ou os botões anterior/seguinte). A lista pode ser a de acompanhamento, a carteira ou o
 * catálogo, com pesquisa e ordenação. ?instrumento, ?estrategia, ?fonte e ?ordem ficam no endereço; sem estratégia
 * escolhida, aplica-se a melhor de cada instrumento.
 */
const SOURCES = [{ value: 'lista', label: 'Lista' }, { value: 'carteira', label: 'Carteira' }, { value: 'catalogo', label: 'Catálogo' }];
const SORTS = {
  simbolo: { label: 'Símbolo', cmp: (a, b) => a.symbol.localeCompare(b.symbol) },
  sobe: { label: 'Maiores subidas', cmp: (a, b) => (Number(b.latest?.changePct ?? -Infinity) - Number(a.latest?.changePct ?? -Infinity)) || a.symbol.localeCompare(b.symbol) },
  desce: { label: 'Maiores descidas', cmp: (a, b) => (Number(a.latest?.changePct ?? Infinity) - Number(b.latest?.changePct ?? Infinity)) || a.symbol.localeCompare(b.symbol) },
};
export default function ChartsPage() {
  const [params, setParams] = useSearchParams();
  const source = SOURCES.some((s) => s.value === params.get('fonte')) ? params.get('fonte') : 'lista';
  const sortKey = SORTS[params.get('ordem')] ? params.get('ordem') : 'simbolo';
  const [search, setSearch] = useState('');
  const watchlist = useWatchlist();
  const catalog = useCatalog(source !== 'lista');
  const portfolio = usePortfolio();
  const bestMap = useBestStrategies();
  const qc = useQueryClient();
  const listRef = useRef(null);

  const base = source === 'lista' ? watchlist : catalog;
  const held = new Set((portfolio.data?.positions ?? []).map((p) => p.instrumentId));
  const needle = search.trim().toLowerCase();
  const items = (base.data?.items ?? [])
    .filter((i) => i.status === 'active' && (source !== 'carteira' || held.has(i.id)))
    .filter((i) => !needle || i.symbol.toLowerCase().includes(needle) || i.name?.toLowerCase().includes(needle))
    .sort(SORTS[sortKey].cmp);
  const requested = Number(params.get('instrumento'));
  const index = Math.max(0, items.findIndex((i) => i.id === requested));
  const current = items[index];

  const bestFor = (i) => {
    const b = i && bestMap.data?.get(i.id);
    return b && b.total > 0 && getStrategy(b.strategyId) ? b.strategyId : null;
  };
  // Escolha explícita no menu (incluindo «nenhuma») mantém-se ao mudar de instrumento; sem ela, a melhor de cada um.
  const raw = params.get('estrategia');
  const strategyFor = (i) => (raw == null ? bestFor(i) : raw === '1' ? DEFAULT_STRATEGY_ID : getStrategy(raw) ? raw : null);
  const strategy = strategyFor(current);
  const bestId = bestFor(current);

  const setParam = (key, value) => setParams((p) => {
    const next = new URLSearchParams(p);
    next.set(key, value);
    return next;
  }, { replace: true });
  const select = (i) => setParam('instrumento', String(i.id));
  const move = (delta) => {
    if (!items.length) return;
    const next = items[(index + delta + items.length) % items.length];
    select(next);
    listRef.current?.querySelector(`[data-id="${next.id}"]`)?.focus();
  };

  const quotes = useQuotes(current?.id, Boolean(current), quotesFromFor(strategy, current?.lastSession));

  // Pré-carrega os vizinhos na lista, para a troca ser imediata.
  useEffect(() => {
    if (items.length < 2 || !current) return;
    for (const d of [1, -1]) {
      const n = items[(index + d + items.length) % items.length];
      const from = quotesFromFor(strategyFor(n), n.lastSession);
      qc.prefetchQuery({ queryKey: keys.quotes(n.id, from), queryFn: () => api.get(`/instruments/${n.id}/quotes${from ? `?from=${from}` : ''}`) });
    }
  });

  const onListKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  };

  const listControls = (
    <div className="stack" style={{ gap: '0.5rem' }}>
      <Segmented label="Lista" value={source} onChange={(v) => setParam('fonte', v)} options={SOURCES} />
      <div className="row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
        <label className="visually-hidden" htmlFor="charts-search">Pesquisar na lista</label>
        <input id="charts-search" className="input" type="search" placeholder="Pesquisar" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 0 }} />
        <label className="visually-hidden" htmlFor="charts-sort">Ordenar</label>
        <select id="charts-sort" className="select" value={sortKey} onChange={(e) => setParam('ordem', e.target.value)} style={{ width: 'auto' }}>
          {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
      </div>
    </div>
  );

  if (base.isPending) return <Loading rows={8} />;
  if (base.error) return <ErrorState error={base.error} onRetry={base.refetch} />;
  if (!current) {
    const empty = needle ? `Nada encontrado para «${search.trim()}»`
      : source === 'carteira' ? 'A carteira não tem posições' : source === 'catalogo' ? 'O catálogo não tem instrumentos activos' : 'A sua lista não tem instrumentos activos';
    return (
      <>
        <div className="page-head"><h1 className="page-title">Charts</h1></div>
        <div className="card stack" style={{ maxWidth: '28rem', marginBottom: '1rem' }}>{listControls}</div>
        <EmptyState title={empty} action={source === 'lista' && !needle ? <Link className="button" to="/acompanhar">Ir para Acompanhar</Link> : null}>
          Escolha outra lista ou outra pesquisa.
        </EmptyState>
      </>
    );
  }

  const best = bestMap.data?.get(current.id);
  const bestStrategy = best && getStrategy(best.strategyId);
  const showing = quotes.data?.instrumentId === current.id;

  return (
    <div className="charts-page">
      <section className="card charts-main" aria-labelledby="chart-symbol">
        <div className="spread charts-head">
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: '0.75rem', alignItems: 'baseline' }}>
              <h1 id="chart-symbol" className="card-title" style={{ fontSize: '1.5rem' }}>{current.symbol}</h1>
              {current.latest && <span className="financial-value" style={{ fontSize: '1.25rem', fontWeight: 600 }}>{f.price(current.latest.close, current.currency)}</span>}
              {current.latest && <PriceChange value={current.latest.changePct} />}
            </div>
            <p className="small muted">
              {[current.name, current.exchange].filter(Boolean).join(' · ')}
              {current.latest && <> · <QuoteDate date={current.latest.date} /></>}
            </p>
          </div>
          <div className="row">
            <Button size="small" variant="ghost" className="icon-button" onClick={() => move(-1)} title="Instrumento anterior (↑)">
              <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="chevron" size={18} /></span><span className="visually-hidden">Instrumento anterior</span>
            </Button>
            <span className="small muted">{index + 1} / {items.length}</span>
            <Button size="small" variant="ghost" className="icon-button" onClick={() => move(1)} title="Instrumento seguinte (↓)">
              <Icon name="chevron" size={18} /><span className="visually-hidden">Instrumento seguinte</span>
            </Button>
            <StrategySelect value={strategy} onChange={(id) => setParam('estrategia', id ?? 'nenhuma')} allowNone best={bestId} />
            <Link className="button" to={`/instrumentos/${current.id}${strategy ? `?estrategia=${strategy}` : ''}`}>Abrir instrumento</Link>
          </div>
        </div>
        {quotes.isPending ? <Loading rows={8} label="A carregar o gráfico…" /> : quotes.error ? <ErrorState error={quotes.error} onRetry={quotes.refetch} /> :
          quotes.data.quotes.length === 0 ? <EmptyState title="Sem cotações disponíveis">O fornecedor não devolveu sessões para este instrumento.</EmptyState> : (
            <div aria-busy={!showing} style={{ opacity: showing ? 1 : 0.5, transition: 'opacity var(--duration-fast)' }}>
              <Suspense fallback={<Loading rows={8} label="A carregar o gráfico…" />}>
                <DailyChart quotes={quotes.data.quotes} currency={current.currency} symbol={quotes.data.symbol} strategy={showing ? strategy : null} />
              </Suspense>
            </div>
          )}
      </section>

      <aside className="card charts-side" aria-labelledby="charts-list-title">
        <div className="card-head">
          <h2 id="charts-list-title" className="card-title">{SOURCES.find((s) => s.value === source).label}</h2>
          <span className="small muted">{items.length}</span>
        </div>
        {listControls}
        <div className="charts-list-head small muted" aria-hidden="true"><span>Instrumento</span><span className="r">Último</span><span className="r">Var.</span></div>
        <ul className="charts-list" ref={listRef} onKeyDown={onListKey} aria-label={`Instrumentos (${SOURCES.find((s) => s.value === source).label}; setas para mudar)`}>
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" data-id={i.id} className="charts-item" aria-current={i.id === current.id ? 'true' : undefined} onClick={() => select(i)}
                title={i.name ?? i.symbol}>
                <span className="charts-sym">{i.symbol}</span>
                <span className="r financial-value">{i.latest ? f.price(i.latest.close, i.currency) : '—'}</span>
                <span className="r">{i.latest ? <PriceChange value={i.latest.changePct} showLabel={false} /> : '—'}</span>
              </button>
            </li>
          ))}
        </ul>
        <dl className="summary-box charts-detail">
          <dt>Instrumento</dt><dd>{current.name ?? current.symbol}</dd>
          <dt>Melhor estratégia</dt>
          <dd>{bestMap.isPending ? '…' : bestStrategy && best.total > 0 ? <>{bestStrategy.name} <span className="positive">{f.signedMoney(best.total)}</span></> : 'Nenhuma ganha'}</dd>
          {current.isinMic && <><dt>Livro de ofertas</dt><dd><Link to={`/orderbook?instrumento=${current.id}`}>{current.isinMic}</Link></dd></>}
        </dl>
      </aside>
    </div>
  );
}
