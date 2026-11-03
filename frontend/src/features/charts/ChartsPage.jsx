import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { keys, useBestStrategies, useCatalog, useInstrument, usePortfolio, useQuotes, useWatchlist } from '../../lib/queries.js';
import { InstrumentStatus, PriceChange, QuoteDate } from '../../components/finance/finance.jsx';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Button, Notice, Segmented } from '../../components/ui/controls.jsx';
import Icon from '../../components/ui/Icon.jsx';
import StrategySelect from '../../components/finance/StrategySelect.jsx';
import { DEFAULT_STRATEGY_ID, getStrategy } from '../../lib/strategy.js';
import TradeDialog from '../portfolio/TradeDialog.jsx';
import AlertDialog from '../alerts/AlertDialog.jsx';

// O gráfico (Recharts) só é carregado quando é preciso.
const DailyChart = lazy(() => import('../../components/finance/DailyChart.jsx'));

/** Início das cotações a pedir: estratégias com aquecimento precisam de histórico antes da janela em que actuam. */
const quotesFromFor = (strategyId, lastSession) => {
  const st = getStrategy(strategyId);
  return st?.warmupYears && lastSession ? f.yearsBefore(lastSession, st.windowYears + st.warmupYears) : undefined;
};

/**
 * Charts: o sítio único do instrumento. O gráfico (velas ou linha, volume, indicadores, momento e estratégia), as
 * ações (lista, alerta, simulação, livro de ofertas) e, à direita, uma lista para passar de um instrumento a outro
 * sem mudar de página (clique, setas ↑/↓ ou botões anterior/seguinte): a de acompanhamento, a carteira ou o
 * catálogo, com pesquisa e ordenação. ?instrumento, ?estrategia, ?fonte e ?ordem ficam no endereço; um instrumento
 * pedido que não está na lista (ex.: ligação do BackTest) também é mostrado. Sem estratégia escolhida, aplica-se a
 * melhor de cada instrumento. A antiga página do instrumento (/instrumentos/:id) redirecciona para aqui.
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
  const [trading, setTrading] = useState(false);
  const [alerting, setAlerting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const toast = useToast();
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
  // Instrumento mostrado: o pedido no endereço (esteja ou não na lista) ou o primeiro da lista.
  const requested = Number(params.get('instrumento')) || null;
  const currentId = requested ?? items[0]?.id ?? null;
  const index = items.findIndex((i) => i.id === currentId);
  const detail = useInstrument(currentId);
  const current = detail.data ?? items[index];

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
    const from = index >= 0 ? index : delta > 0 ? -1 : 0;
    const next = items[(from + delta + items.length) % items.length];
    select(next);
    listRef.current?.querySelector(`[data-id="${next.id}"]`)?.focus();
  };

  const quotes = useQuotes(current?.id, current?.status === 'active', quotesFromFor(strategy, current?.lastSession));

  // Pré-carrega os vizinhos na lista, para a troca ser imediata.
  useEffect(() => {
    if (items.length < 2 || index < 0) return;
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

  async function toggleWatch() {
    setBusy(true);
    setActionError(null);
    try {
      if (current.inWatchlist) await api.del(`/watchlist/items/${current.id}`);
      else await api.post('/watchlist/items', { instrumentId: current.id });
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.instrument(current.id) }), qc.invalidateQueries({ queryKey: keys.watchlist }),
        qc.invalidateQueries({ queryKey: ['instruments'] }),
      ]);
      toast(current.inWatchlist ? 'Removido da lista' : 'Adicionado à lista');
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

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
  if (!currentId) {
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
  if (!current) return detail.error ? <ErrorState error={detail.error} onRetry={detail.refetch} /> : <Loading rows={8} />;

  const best = bestMap.data?.get(current.id);
  const bestStrategy = best && getStrategy(best.strategyId);
  const showing = quotes.data?.instrumentId === current.id;
  const tradable = current.status === 'active' && current.currency === 'EUR' && current.latest;
  // A carga inicial começa três anos antes do dia da recolha: tolera-se uma semana de diferença.
  const coverageLimit = current.lastSession && (() => {
    const [y, m, d] = current.lastSession.split('-').map(Number);
    return new Date(Date.UTC(y - 3, m - 1, d + 7)).toISOString().slice(0, 10);
  })();

  return (
    <div className="charts-page">
      <section className="card charts-main" aria-labelledby="chart-symbol">
        <div className="spread charts-head">
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: '0.75rem', alignItems: 'baseline' }}>
              <h1 id="chart-symbol" className="card-title" style={{ fontSize: '1.5rem' }}>{current.symbol}</h1>
              {current.latest && <span className="financial-value" style={{ fontSize: '1.25rem', fontWeight: 600 }}>{f.price(current.latest.close, current.currency)}</span>}
              {current.latest && <PriceChange value={current.latest.changePct} />}
              <InstrumentStatus status={current.status} />
            </div>
            <p className="small muted">
              {[current.name, current.exchange, current.currency].filter(Boolean).join(' · ') || 'Dados do instrumento ainda por confirmar'}
              {current.latest && <> · <QuoteDate date={current.latest.date} /></>}
            </p>
          </div>
          <div className="row charts-actions">
            <Button size="small" variant="ghost" className="icon-button" onClick={() => move(-1)} title="Instrumento anterior (↑)">
              <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="chevron" size={18} /></span><span className="visually-hidden">Instrumento anterior</span>
            </Button>
            <span className="small muted">{index >= 0 ? index + 1 : '—'} / {items.length}</span>
            <Button size="small" variant="ghost" className="icon-button" onClick={() => move(1)} title="Instrumento seguinte (↓)">
              <Icon name="chevron" size={18} /><span className="visually-hidden">Instrumento seguinte</span>
            </Button>
            <StrategySelect value={strategy} onChange={(id) => setParam('estrategia', id ?? 'nenhuma')} allowNone best={bestId} disabled={current.status !== 'active'} />
            <Button onClick={toggleWatch} busy={busy} disabled={current.status === 'invalid' && !current.inWatchlist}>
              {current.inWatchlist ? 'Remover da lista' : 'Adicionar à lista'}
            </Button>
            <Button onClick={() => setAlerting(true)} disabled={current.status === 'invalid'}>Criar alerta</Button>
            {current.isinMic && <Link className="button" to={`/orderbook?instrumento=${current.id}`}>Livro de ofertas</Link>}
            <Button variant="primary" onClick={() => setTrading(true)} disabled={!tradable}>Simular operação</Button>
          </div>
        </div>

        <div className="stack" style={{ gap: '0.75rem' }}>
          {actionError && <Notice tone="error">{actionError}</Notice>}
          {current.status === 'pending' && (
            <Notice>
              A validar no fornecedor de dados: confirma-se que o símbolo existe e está cotado em EUR, e carregam-se até três anos de histórico diário.
              Esta página actualiza-se sozinha.{detail.data?.fetch?.lastError && <> Última tentativa: {detail.data.fetch.lastError}.</>}
            </Notice>
          )}
          {current.status === 'invalid' && <Notice tone="error">Instrumento inválido: {current.statusReason}.</Notice>}
          {current.status === 'active' && coverageLimit && current.firstSession > coverageLimit && (
            <p className="small warning-text">
              Cobertura inferior a três anos: o fornecedor só tem dados desde {f.date(current.firstSession)}, por isso a SMA200 e o momento podem não cobrir todo o gráfico.
            </p>
          )}
          {current.currency && current.currency !== 'EUR' && <p className="small warning-text">Só são simuláveis instrumentos em EUR.</p>}
        </div>

        {current.status !== 'active' ? null : quotes.isPending ? <Loading rows={8} label="A carregar o gráfico…" /> : quotes.error ? <ErrorState error={quotes.error} onRetry={quotes.refetch} /> :
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
          {detail.data?.sessions != null && <><dt>Sessões</dt><dd>{detail.data.sessions}</dd></>}
          {current.firstSession && <><dt>Dados</dt><dd>{f.date(current.firstSession)} a {f.date(current.lastSession)}</dd></>}
          <dt>Melhor estratégia</dt>
          <dd>{bestMap.isPending ? '…' : bestStrategy && best.total > 0 ? <>{bestStrategy.name} <span className="positive">{f.signedMoney(best.total)}</span></> : 'Nenhuma ganha'}</dd>
        </dl>
      </aside>

      <TradeDialog open={trading} onClose={() => setTrading(false)} instrument={current} />
      <AlertDialog open={alerting} onClose={() => setAlerting(false)} instrument={current} onDone={toast} />
    </div>
  );
}
