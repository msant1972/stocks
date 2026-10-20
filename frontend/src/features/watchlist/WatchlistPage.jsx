import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { keys, useInstrumentSearch, useOrderbookSummary, useStatus, useWatchlist } from '../../lib/queries.js';
import { InstrumentStatus, PriceChange } from '../../components/finance/finance.jsx';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Button } from '../../components/ui/controls.jsx';
import Icon from '../../components/ui/Icon.jsx';
import AddInstrumentsDialog from './AddInstrumentsDialog.jsx';

const ISIN_MIC_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]-[A-Z0-9]{4}$/;

/** ISIN-MIC do instrumento, com edição directa (usado pelo módulo Orderbook). */
function IsinMicCell({ item }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const start = () => {
    setValue(item.isinMic ?? (item.suggestedMic ? `-${item.suggestedMic}` : ''));
    setError(null);
    setEditing(true);
  };
  async function save(next) {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/instruments/${item.id}/isin-mic`, { isinMic: next || null });
      await Promise.all([qc.invalidateQueries({ queryKey: ['instruments'] }), qc.invalidateQueries({ queryKey: keys.watchlist })]);
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  // Fora da Euronext não há livro de ofertas: a célula fica vazia, sem «Definir».
  if (!editing && !item.isinMic && !item.suggestedMic) return null;
  if (!editing) {
    return (
      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
        {item.isinMic
          ? <Link to={`/orderbook?instrumento=${item.id}`} className="isin-mic" title="Ver o livro de ofertas">{item.isinMic}</Link>
          : <span className="small muted">por definir</span>}
        {item.isinMic ? (
          <Button size="small" variant="ghost" className="icon-button" onClick={start} title="Editar ISIN-MIC">
            <Icon name="edit" size={18} /><span className="visually-hidden">Editar ISIN-MIC de {item.symbol}</span>
          </Button>
        ) : (
          <Button size="small" variant="ghost" onClick={start}>
            Definir<span className="visually-hidden"> ISIN-MIC de {item.symbol}</span>
          </Button>
        )}
      </div>
    );
  }
  const normalised = value.trim().toUpperCase();
  const formatOk = normalised === '' || ISIN_MIC_RE.test(normalised);
  return (
    <form className="stack" style={{ gap: 4, minWidth: '15rem' }} onSubmit={(e) => { e.preventDefault(); if (formatOk) save(normalised); }}>
      <label className="visually-hidden" htmlFor={`isin-${item.id}`}>ISIN-MIC de {item.symbol}</label>
      <input id={`isin-${item.id}`} className="input num" style={{ minHeight: '2.25rem', padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}
        value={value} onChange={(e) => setValue(e.target.value)} placeholder={`ISIN-${item.suggestedMic ?? 'MIC'}`} autoFocus
        aria-invalid={!formatOk || undefined} spellCheck={false} autoComplete="off" />
      {(!formatOk || error) && <span className="field-error">{error ?? 'Formato: ISIN (12) - MIC (4), ex.: PTFCP0AM0008-XLIS'}</span>}
      <div className="row" style={{ gap: 4 }}>
        <Button type="submit" size="small" variant="primary" busy={busy} disabled={!formatOk}>Guardar</Button>
        <Button size="small" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
      </div>
    </form>
  );
}

const IMBALANCE_HINT = (v) => (v > 0.1 ? 'pressão compradora' : v < -0.1 ? 'pressão vendedora' : 'equilibrado');

/** Mid e desequilíbrio do livro Euronext (atraso 15 min), como no Orderbook. */
function BookCells({ item, summary }) {
  if (!item.isinMic) return <><td className="r muted">—</td><td className="r muted">—</td></>;
  const s = summary.byId.get(item.id);
  if (!s) {
    const label = summary.isLoading ? <span className="muted" aria-label="A carregar">…</span> : <span className="muted">—</span>;
    return <><td className="r">{label}</td><td className="r">{label}</td></>;
  }
  if (s.error || s.mid == null) {
    const why = s.error === 'NOT_FOUND' ? 'Sem livro na Euronext para este ISIN-MIC'
      : s.error ? 'A Euronext não respondeu' : 'Livro sem ofertas dos dois lados';
    return <><td className="r muted" title={why}>—</td><td className="r muted" title={why}>{s.imbalance == null ? '—' : f.number(s.imbalance).replace('-', '−')}</td></>;
  }
  const tone = s.imbalance > 0.1 ? 'positive' : s.imbalance < -0.1 ? 'negative' : '';
  return (
    <>
      <td className="r num" title={s.crossed ? 'Livro cruzado (provável leilão)' : undefined}>
        <Link to={`/orderbook?instrumento=${item.id}`} className="row-link" style={{ fontWeight: 400 }}>{f.price(s.mid, item.currency)}</Link>
      </td>
      <td className={`r num ${tone}`} title={IMBALANCE_HINT(s.imbalance)}>
        {f.number(s.imbalance).replace('-', '−')}<span className="visually-hidden">, {IMBALANCE_HINT(s.imbalance)}</span>
      </td>
    </>
  );
}

const CATALOG_KEY = 'stocks.catalogo';
const LIST_SORT_KEY = 'stocks.ordemLista';
const readStored = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch { /* sem armazenamento: só nesta sessão */ } };

const SORT_DEFAULT_DIR = { symbol: 'asc', volume: 'desc', change: 'desc', imbalance: 'desc' };
const SERVER_SORTS = ['symbol', 'volume', 'change'];

/** Próxima ordenação ao clicar num cabeçalho: a mesma coluna inverte, outra começa no sentido habitual. */
const nextSort = (sort, key) => (sort.key === key
  ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
  : { key, dir: SORT_DEFAULT_DIR[key] });

/** Ordena localmente; os instrumentos sem valor ficam sempre no fim. */
function sortItems(items, { key, dir }, summary) {
  const value = {
    symbol: (i) => i.symbol,
    volume: (i) => i.latest?.volume ?? null,
    change: (i) => (i.latest?.changePct == null ? null : Number(i.latest.changePct)),
    imbalance: (i) => summary.byId.get(i.id)?.imbalance ?? null,
  }[key];
  const sign = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null || vb == null) return (va == null) - (vb == null) || a.symbol.localeCompare(b.symbol);
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return c * sign || a.symbol.localeCompare(b.symbol);
  });
}

function SortHeader({ label, sortKey, sort, onSort, align, title }) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th scope="col" className={align === 'r' ? 'r' : undefined} aria-sort={ariaSort} title={title}>
      <button type="button" className={`sort-button${active ? ' active' : ''}`} onClick={() => onSort(nextSort(sort, sortKey))}>
        {label}
        <span className="sort-arrow" aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

/**
 * clientKeys: colunas ordenadas aqui, sobre as linhas recebidas (as restantes já vêm ordenadas do servidor).
 */
function InstrumentTable({ items, action, sort, onSort, clientKeys = Object.keys(SORT_DEFAULT_DIR), note }) {
  const summary = useOrderbookSummary(items);
  const rows = clientKeys.includes(sort.key) ? sortItems(items, sort, summary) : items;
  const header = (label, key, extra) => <SortHeader label={label} sortKey={key} sort={sort} onSort={onSort} {...extra} />;
  return (
    <>
    {note && sort.key === 'imbalance' && <p className="small muted" style={{ marginBottom: '0.5rem' }}>{note}</p>}
    <div className="table-wrap" tabIndex={0} aria-label="Tabela de instrumentos">
      <table className="data">
        <thead>
          <tr>
            {header('Instrumento', 'symbol')}
            <th scope="col">Estado</th>
            <th scope="col" className="r">Último fecho</th>
            {header('Volume', 'volume', { align: 'r' })}
            {header('Variação', 'change', { align: 'r' })}
            <th scope="col" className="r" title="Ponto médio entre a melhor compra e a melhor venda no livro Euronext (atraso 15 min)">Mid</th>
            {header('Desequilíbrio', 'imbalance', { align: 'r', title: '(compras − vendas) / total das quantidades no livro: positivo = pressão compradora' })}
            <th scope="col">ISIN-MIC</th>
            <th scope="col"><span className="visually-hidden">Acções</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id}>
              <td>
                <Link to={`/instrumentos/${i.id}`} className="row-link">{i.symbol}</Link>
                <div className="small muted">{[i.name, i.exchange].filter(Boolean).join(' · ') || (i.status === 'invalid' ? i.statusReason : 'A validar no fornecedor')}</div>
              </td>
              <td><InstrumentStatus status={i.status} /></td>
              <td className="r">
                {i.latest ? f.price(i.latest.close, i.currency) : '—'}
                {i.latest && <div className="small muted" style={{ whiteSpace: 'nowrap' }}>{f.date(i.latest.date)}</div>}
              </td>
              <td className="r">{f.quantity(i.latest?.volume)}</td>
              <td className="r">{i.latest ? <PriceChange value={i.latest.changePct} showLabel={false} /> : '—'}</td>
              <BookCells item={i} summary={summary} />
              <td><IsinMicCell item={i} /></td>
              <td className="r">{action(i)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

export default function WatchlistPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [adding, setAdding] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const toast = useToast();
  const qc = useQueryClient();
  const watchlist = useWatchlist();
  const catalogSort = { key: params.get('ordem') ?? 'symbol', dir: params.get('sentido') ?? SORT_DEFAULT_DIR[params.get('ordem') ?? 'symbol'] };
  if (!SORT_DEFAULT_DIR[catalogSort.key]) catalogSort.key = 'symbol';
  const setCatalogSort = (s) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (s.key === 'symbol' && s.dir === 'asc') { next.delete('ordem'); next.delete('sentido'); } else { next.set('ordem', s.key); next.set('sentido', s.dir); }
    return next;
  }, { replace: true });
  const serverSort = SERVER_SORTS.includes(catalogSort.key) ? { sort: catalogSort.key, dir: catalogSort.dir } : undefined;
  // Catálogo visível: a última escolha do utilizador; sem escolha, só quando a lista está vazia.
  // Uma pesquisa (ex.: vinda da barra de topo) mostra-o sempre.
  const [catalogChoice, setCatalogChoice] = useState(() => readStored(CATALOG_KEY));
  const listEmpty = watchlist.data?.items.length === 0;
  const showCatalog = Boolean(q) || (catalogChoice ? catalogChoice === 'on' : listEmpty);
  const toggleCatalog = () => {
    const next = showCatalog ? 'off' : 'on';
    setCatalogChoice(next);
    store(CATALOG_KEY, next);
    if (next === 'off' && q) setParams((p) => { const n = new URLSearchParams(p); n.delete('q'); return n; }, { replace: true });
  };
  const search = useInstrumentSearch(q, serverSort, showCatalog);
  const [listSort, setListSortState] = useState(() => {
    try {
      const saved = JSON.parse(readStored(LIST_SORT_KEY));
      return SORT_DEFAULT_DIR[saved?.key] && ['asc', 'desc'].includes(saved.dir) ? saved : { key: 'symbol', dir: 'asc' };
    } catch { return { key: 'symbol', dir: 'asc' }; }
  });
  const setListSort = (s) => { setListSortState(s); store(LIST_SORT_KEY, JSON.stringify(s)); };
  const status = useStatus();
  const pending = status.data?.instruments.pending ?? 0;
  const [forcing, setForcing] = useState(false);

  async function forceFetch() {
    setForcing(true);
    setActionError(null);
    try {
      const r = await api.post('/instruments/fetch', {});
      qc.invalidateQueries({ queryKey: keys.status });
      toast(r.queued === 0 ? 'Não há instrumentos por validar.'
        : r.started ? `Validação de ${r.queued} ${r.queued === 1 ? 'instrumento iniciada' : 'instrumentos iniciada'}; a lista actualiza-se sozinha.`
          : `${r.queued} ${r.queued === 1 ? 'instrumento ficou' : 'instrumentos ficaram'} na fila; a validação começa dentro de 5 minutos.`);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setForcing(false);
    }
  }

  async function toggle(i) {
    setPendingId(i.id);
    setActionError(null);
    try {
      if (i.inWatchlist) await api.del(`/watchlist/items/${i.id}`);
      else await api.post('/watchlist/items', { instrumentId: i.id });
      await Promise.all([qc.invalidateQueries({ queryKey: keys.watchlist }), qc.invalidateQueries({ queryKey: ['instruments'] })]);
      toast(i.inWatchlist ? `${i.symbol} removido da lista` : `${i.symbol} adicionado à lista`);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPendingId(null);
    }
  }

  const action = (i) => (i.inWatchlist ? (
    <Button size="small" variant="ghost" className="icon-button" busy={pendingId === i.id} onClick={() => toggle(i)} title="Remover da lista">
      <Icon name="trash" size={18} /><span className="visually-hidden">Remover {i.symbol} da lista</span>
    </Button>
  ) : (
    <Button size="small" variant="ghost" busy={pendingId === i.id} onClick={() => toggle(i)} disabled={i.status === 'invalid'}>
      Acompanhar<span className="visually-hidden"> {i.symbol}</span>
    </Button>
  ));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Acompanhar</h1>
          <p className="page-sub">A sua lista de instrumentos e o catálogo partilhado. Cotações diárias, não em tempo real; mid e desequilíbrio do livro Euronext com 15 minutos de atraso.</p>
        </div>
        <div className="row">
          {/* Só aparece quando há instrumentos «A validar». */}
          {pending > 0 && (
            <Button onClick={forceFetch} busy={forcing} title="Pedir já ao Yahoo Finance os dados dos instrumentos «A validar»">
              {forcing ? 'A pedir…' : `Validar agora (${pending})`}
            </Button>
          )}
          <Button className="button-toggle" onClick={toggleCatalog} aria-expanded={showCatalog} aria-controls="catalog-section"
            title={showCatalog ? 'Esconder o catálogo partilhado' : 'Mostrar o catálogo partilhado'}>
            <Icon name="search" size={18} />Catálogo
          </Button>
          <Link className="button mobile-only-inline" to="/orderbook">Orderbook</Link>
          <Button variant="primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />Adicionar instrumentos</Button>
        </div>
      </div>
      {pending > 0 && (
        <p className="small muted" role="status" style={{ marginTop: '-0.75rem', marginBottom: '1.25rem' }}>
          {pending} {pending === 1 ? 'instrumento' : 'instrumentos'} a validar no Yahoo Finance. A lista actualiza-se sozinha.
        </p>
      )}

      <div className="stack">
        {showCatalog && <section className="card" id="catalog-section" aria-labelledby="search-title">
          <div className="card-head">
            <h2 id="search-title" className="card-title">Catálogo partilhado</h2>
            {search.data && <span className="small muted">{search.data.total} {search.data.total === 1 ? 'instrumento' : 'instrumentos'}</span>}
          </div>
          <form role="search" onSubmit={(e) => e.preventDefault()} style={{ marginBottom: '1rem' }}>
            <label htmlFor="catalog-q" className="visually-hidden">Designação ou símbolo</label>
            <input id="catalog-q" className="input" type="search" placeholder="Designação ou símbolo (ex.: Galp, SIE.DE)"
              value={q} onChange={(e) => setParams((p) => {
                const next = new URLSearchParams(p);
                if (e.target.value) next.set('q', e.target.value); else next.delete('q');
                return next;
              }, { replace: true })} />
          </form>
          {actionError && <ErrorState error={{ message: actionError }} />}
          {search.isPending ? <Loading /> : search.error ? <ErrorState error={search.error} onRetry={search.refetch} /> :
            search.data.items.length === 0 ? (
              <EmptyState
                title={q ? `Nenhum instrumento encontrado para «${q}»` : 'O catálogo está vazio'}
                action={<Button onClick={() => setAdding(true)}>Adicionar ao catálogo</Button>}
              >
                {q ? 'Se o símbolo ainda não está no catálogo, pode adicioná-lo.' : 'Adicione os primeiros símbolos, à mão ou por Excel.'}
              </EmptyState>
            ) : (
              <InstrumentTable items={search.data.items} action={action} sort={catalogSort} onSort={setCatalogSort} clientKeys={['imbalance']}
                note={search.data.total > search.data.items.length
                  ? `Ordenados por desequilíbrio os ${search.data.items.length} instrumentos mostrados (o livro é pedido à Euronext só para estes). Pesquise para restringir a lista.`
                  : null} />
            )}
        </section>}

        <section className="card" aria-labelledby="mine-title">
          <div className="card-head">
            <h2 id="mine-title" className="card-title">A minha lista</h2>
            {watchlist.data && <span className="small muted">{watchlist.data.items.length} {watchlist.data.items.length === 1 ? 'instrumento' : 'instrumentos'}</span>}
          </div>
          {watchlist.isPending ? <Loading /> : watchlist.error ? <ErrorState error={watchlist.error} onRetry={watchlist.refetch} /> :
            watchlist.data.items.length === 0 ? (
              <EmptyState title="A lista está vazia" action={showCatalog
                ? <Button onClick={() => setAdding(true)}>Adicionar instrumentos</Button>
                : <Button onClick={toggleCatalog}>Mostrar o catálogo</Button>}>
                Pesquise no catálogo ou adicione símbolos novos, à mão ou por Excel.
              </EmptyState>
            ) : <InstrumentTable items={watchlist.data.items} action={action} sort={listSort} onSort={setListSort} />}
        </section>
      </div>

      <AddInstrumentsDialog open={adding} onClose={() => setAdding(false)} onDone={toast} />
    </>
  );
}
