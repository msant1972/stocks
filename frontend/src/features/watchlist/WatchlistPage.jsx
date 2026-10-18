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

function InstrumentTable({ items, action }) {
  return (
    <div className="table-wrap" tabIndex={0} aria-label="Tabela de instrumentos">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Instrumento</th>
            <th scope="col">Estado</th>
            <th scope="col" className="r">Último fecho</th>
            <th scope="col" className="r">Variação</th>
            <th scope="col">Sessão</th>
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
              <td className="r">{i.latest ? f.price(i.latest.close, i.currency) : '—'}</td>
              <td className="r">{i.latest ? <PriceChange value={i.latest.changePct} /> : '—'}</td>
              <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{i.latest ? f.date(i.latest.date) : '—'}</td>
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

  const action = (i) => (
    <Button size="small" variant="ghost" busy={pendingId === i.id} onClick={() => toggle(i)} disabled={i.status === 'invalid' && !i.inWatchlist}>
      {i.inWatchlist ? 'Remover' : 'Acompanhar'}<span className="visually-hidden"> {i.symbol}</span>
    </Button>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Acompanhar</h1>
          <p className="page-sub">A sua lista de instrumentos e o catálogo partilhado. Cotações diárias, não em tempo real.</p>
        </div>
        <div className="row">
          {pending > 0 && (
            <Button onClick={forceFetch} busy={forcing} title="Pedir já ao Yahoo Finance os dados dos instrumentos «A validar»">
              {forcing ? 'A pedir…' : `Validar agora (${pending})`}
            </Button>
          )}
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
            {search.data && <span className="small muted">{search.data.total} instrumentos</span>}
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
            {watchlist.data && <span className="small muted">{watchlist.data.items.length} instrumentos</span>}
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
