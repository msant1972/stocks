import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { keys, useInstrumentSearch, useStatus, useWatchlist } from '../../lib/queries.js';
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
  if (!editing) {
    return (
      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
        {item.isinMic
          ? <Link to={`/orderbook?instrumento=${item.id}`} className="isin-mic" title="Ver o livro de ofertas">{item.isinMic}</Link>
          : <span className="small muted">{item.suggestedMic ? 'por definir' : 'não Euronext'}</span>}
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

function InstrumentTable({ items, action }) {
  return (
    <div className="table-wrap" tabIndex={0} aria-label="Tabela de instrumentos">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Instrumento</th>
            <th scope="col">Estado</th>
            <th scope="col" className="r">Último fecho</th>
            <th scope="col" className="r">Volume</th>
            <th scope="col" className="r">Variação</th>
            <th scope="col">ISIN-MIC</th>
            <th scope="col"><span className="visually-hidden">Acções</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
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
              <td><IsinMicCell item={i} /></td>
              <td className="r">{action(i)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  const search = useInstrumentSearch(q);
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
          <p className="page-sub">A sua lista de instrumentos e o catálogo partilhado. Cotações diárias, não em tempo real.</p>
        </div>
        <div className="row">
          <Button
            onClick={forceFetch} busy={forcing} disabled={pending === 0}
            title={pending > 0 ? 'Pedir já ao Yahoo Finance os dados dos instrumentos «A validar»' : 'Todos os instrumentos do catálogo estão validados'}
          >
            {forcing ? 'A pedir…' : pending > 0 ? `Validar agora (${pending})` : 'Nada por validar'}
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
        <section className="card" aria-labelledby="search-title">
          <div className="card-head">
            <h2 id="search-title" className="card-title">Catálogo partilhado</h2>
            {search.data && <span className="small muted">{search.data.total} {search.data.total === 1 ? 'instrumento' : 'instrumentos'}</span>}
          </div>
          <form role="search" onSubmit={(e) => e.preventDefault()} style={{ marginBottom: '1rem' }}>
            <label htmlFor="catalog-q" className="visually-hidden">Designação ou símbolo</label>
            <input id="catalog-q" className="input" type="search" placeholder="Designação ou símbolo (ex.: Galp, SIE.DE)"
              value={q} onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })} />
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
            ) : <InstrumentTable items={search.data.items} action={action} />}
        </section>

        <section className="card" aria-labelledby="mine-title">
          <div className="card-head">
            <h2 id="mine-title" className="card-title">A minha lista</h2>
            {watchlist.data && <span className="small muted">{watchlist.data.items.length} {watchlist.data.items.length === 1 ? 'instrumento' : 'instrumentos'}</span>}
          </div>
          {watchlist.isPending ? <Loading /> : watchlist.error ? <ErrorState error={watchlist.error} onRetry={watchlist.refetch} /> :
            watchlist.data.items.length === 0 ? (
              <EmptyState title="A lista está vazia" action={<Button onClick={() => setAdding(true)}>Adicionar instrumentos</Button>}>
                Pesquise no catálogo ou adicione símbolos novos, à mão ou por Excel.
              </EmptyState>
            ) : <InstrumentTable items={watchlist.data.items} action={action} />}
        </section>
      </div>

      <AddInstrumentsDialog open={adding} onClose={() => setAdding(false)} onDone={toast} />
    </>
  );
}
