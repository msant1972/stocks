import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import { keys } from '../../lib/queries.js';
import { useToast } from '../../components/feedback/Toast.jsx';
import Icon from '../../components/ui/Icon.jsx';
import * as f from '../../lib/format.js';
import { PnL } from '../../components/finance/finance.jsx';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Button, Dialog, Notice, Segmented } from '../../components/ui/controls.jsx';
import SortHeader, { nextSort } from '../../components/ui/SortHeader.jsx';

const pctTone = (v) => (v > 0 ? 'positive' : v < 0 ? 'negative' : '');

function sortRows(rows, { key, dir }) {
  const value = (r) => (key === 'symbol' ? r.symbol : key === 'total' ? r.total : key === 'buyHoldPct' ? r.buyHoldPct : r.results[key]);
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null || vb == null) return (va == null) - (vb == null);
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return c * sign || a.symbol.localeCompare(b.symbol);
  });
}

/** Botão de ícone para pôr ou tirar o instrumento de «A minha lista». */
function WatchButton({ row, busy, onToggle }) {
  const label = row.inWatchlist ? `Remover ${row.symbol} da minha lista` : `Adicionar ${row.symbol} à minha lista`;
  return (
    <Button size="small" variant="ghost" className={`icon-button wl-watch${row.inWatchlist ? ' in' : ''}`} busy={busy}
      onClick={() => onToggle(row)} title={row.inWatchlist ? 'Na minha lista: remover' : 'Adicionar à minha lista'} aria-pressed={row.inWatchlist}>
      <Icon name={row.inWatchlist ? 'trash' : 'plus'} size={18} />
      <span className="visually-hidden">{label}</span>
    </Button>
  );
}

/** Tabela de um grupo (todas ganham / todas perdem), ordenável por qualquer coluna. */
function GroupTable({ id, title, tone, rows, strategies, initialDir, note, pendingIds, onToggle, bulk }) {
  const [sort, setSort] = useState({ key: 'total', dir: initialDir });
  const defaults = { symbol: 'asc', total: initialDir, buyHoldPct: initialDir, ...Object.fromEntries(strategies.map((s) => [s.id, initialDir])) };
  const onSort = (key) => setSort(nextSort(sort, key, defaults));
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const header = (label, key, extra) => <SortHeader label={label} sortKey={key} sort={sort} onSort={onSort} {...extra} />;
  return (
    <section className="card" aria-labelledby={id}>
      <div className="card-head">
        <h2 id={id} className="card-title">
          <span className={`wl-dot ${tone}`} aria-hidden="true" />{title}
        </h2>
        <div className="row" style={{ gap: 12 }}>
          <span className="small muted">{rows.length} {rows.length === 1 ? 'instrumento' : 'instrumentos'} · soma <PnL value={total.toFixed(2)} /></span>
          {bulk}
        </div>
      </div>
      {note && <p className="small muted" style={{ marginBottom: '0.75rem' }}>{note}</p>}
      {rows.length === 0 ? <EmptyState title="Nenhum instrumento">Nenhum instrumento corresponde ao filtro.</EmptyState> : (
        <div className="table-wrap" tabIndex={0} aria-label={title}>
          <table className="data">
            <thead>
              <tr>
                {header('Instrumento', 'symbol')}
                {header('Total', 'total', { align: 'r', title: 'Soma dos resultados das estratégias' })}
                {strategies.map((s) => <SortHeader key={s.id} label={s.name} sortKey={s.id} sort={sort} onSort={onSort} align="r" />)}
                {header('Comprar e manter', 'buyHoldPct', { align: 'r', title: 'Variação de comprar no início do período e manter até ao fim' })}
                <th scope="col" className="r" title="Adicionar à ou remover da minha lista">Minha lista</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.instrumentId}>
                  <td>
                    <Link to={`/instrumentos/${r.instrumentId}`} className="row-link">{r.symbol}</Link>
                    <div className="small muted cx-name">{[r.name, r.exchange].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="r" style={{ fontWeight: 600 }}><PnL value={r.total.toFixed(2)} /></td>
                  {strategies.map((s) => (
                    <td key={s.id} className="r">
                      <Link to={`/instrumentos/${r.instrumentId}?estrategia=${s.id}`} className="wl-cell" title={`Ver a ${s.name} no gráfico`}>
                        <PnL value={r.results[s.id].toFixed(2)} />
                      </Link>
                    </td>
                  ))}
                  <td className={`r num ${pctTone(r.buyHoldPct)}`}>{r.buyHoldPct == null ? '—' : f.pct(r.buyHoldPct.toFixed(1))}</td>
                  <td className="r"><WatchButton row={r} busy={pendingIds.has(r.instrumentId)} onToggle={onToggle} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** WinnersLoosers: instrumentos em que todas as estratégias ganham, ou todas perdem (GET /winners-losers). */
export default function WinnersLosersPage() {
  const [params, setParams] = useSearchParams();
  const scope = params.get('lista') === '1' ? 'watchlist' : 'all';
  const [q, setQ] = useState('');
  const wl = useQuery({ queryKey: ['winners-losers', scope], queryFn: () => api.get(`/winners-losers?scope=${scope}`), staleTime: 5 * 60_000 });
  const data = wl.data;
  const qc = useQueryClient();
  const toast = useToast();
  const [pendingIds, setPendingIds] = useState(new Set());
  const [bulk, setBulk] = useState(null); // { action: 'add' | 'remove', rows }
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState(null);

  /** Actualiza no ecrã o estado «na minha lista» (e, na vista «A minha lista», tira os removidos). */
  const markWatch = (ids, inWatchlist) => {
    for (const sc of ['all', 'watchlist']) {
      qc.setQueryData(['winners-losers', sc], (old) => old && {
        ...old,
        items: old.items
          .map((i) => (ids.has(i.instrumentId) ? { ...i, inWatchlist } : i))
          .filter((i) => sc !== 'watchlist' || i.inWatchlist),
      });
    }
    qc.invalidateQueries({ queryKey: keys.watchlist });
    qc.invalidateQueries({ queryKey: ['instruments'] });
    qc.invalidateQueries({ queryKey: ['promessas'] });
  };

  const setWatch = (row, add) => (add
    ? api.post('/watchlist/items', { instrumentId: row.instrumentId })
    : api.del(`/watchlist/items/${row.instrumentId}`));

  async function toggle(row) {
    setError(null);
    setPendingIds((s) => new Set(s).add(row.instrumentId));
    try {
      await setWatch(row, !row.inWatchlist);
      markWatch(new Set([row.instrumentId]), !row.inWatchlist);
      toast(row.inWatchlist ? `${row.symbol} removido da minha lista` : `${row.symbol} adicionado à minha lista`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPendingIds((s) => { const n = new Set(s); n.delete(row.instrumentId); return n; });
    }
  }

  async function runBulk() {
    const add = bulk.action === 'add';
    setBulkBusy(true);
    setError(null);
    const done = new Set();
    try {
      for (const row of bulk.rows) { // um de cada vez, para não sobrecarregar a API
        await setWatch(row, add);
        done.add(row.instrumentId);
      }
      toast(add ? `${done.size} instrumentos adicionados à minha lista` : `${done.size} instrumentos removidos da minha lista`);
    } catch (err) {
      setError(`${errorMessage(err)} (${done.size} de ${bulk.rows.length} já ${add ? 'adicionados' : 'removidos'})`);
    } finally {
      if (done.size) markWatch(done, add);
      setBulkBusy(false);
      setBulk(null);
    }
  }

  const filtered = useMemo(() => {
    if (!data) return null;
    const needle = q.trim().toLowerCase();
    const items = needle ? data.items.filter((i) => i.symbol.toLowerCase().includes(needle) || (i.name ?? '').toLowerCase().includes(needle)) : data.items;
    return { gain: items.filter((i) => i.group === 'gain'), loss: items.filter((i) => i.group === 'loss') };
  }, [data, q]);

  const names = data?.strategies.map((s) => s.name).join(', ').replace(/, ([^,]*)$/, ' e $1');
  const sumOf = (g) => data.items.filter((i) => i.group === g).reduce((s, i) => s + i.total, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">WinnersLoosers</h1>
          <p className="page-sub">
            Instrumentos em que todas as estratégias ganham, e em que todas perdem{names ? ` (${names})` : ''}, nos últimos 2 anos.
            Simulação no histórico, sem comissões; não é uma recomendação.
          </p>
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <Link className="button mobile-only-inline" to="/promessas">Promessas</Link>
          <Segmented label="Instrumentos" value={scope} onChange={(v) => setParams(v === 'watchlist' ? { lista: '1' } : {}, { replace: true })}
            options={[{ value: 'all', label: 'Todos' }, { value: 'watchlist', label: 'A minha lista' }]} />
        </div>
      </div>

      {wl.isPending ? <section className="card"><Loading rows={8} label="A aplicar as estratégias a todos os instrumentos…" /></section>
        : wl.error ? <section className="card"><ErrorState error={wl.error} onRetry={wl.refetch} /></section>
          : data.items.length === 0 ? (
            <section className="card">
              <EmptyState title="Sem instrumentos" action={scope === 'watchlist' ? <Link className="button" to="/acompanhar">Acompanhar instrumentos</Link> : null}>
                {scope === 'watchlist' ? 'A sua lista não tem instrumentos com resultados nas estratégias.' : 'Ainda não há instrumentos com cotações suficientes.'}
              </EmptyState>
            </section>
          ) : (
            <div className="stack">
              <section className="card" aria-labelledby="wl-summary">
                <h2 id="wl-summary" className="visually-hidden">Resumo</h2>
                <div className="stats" style={{ marginTop: 0 }}>
                  <div>
                    <p className="stat-label">Ganham com todas</p>
                    <p className="stat-value positive">{data.counts.gain}</p>
                    <p className="small muted">soma {f.signedMoney(sumOf('gain').toFixed(2))}</p>
                  </div>
                  <div>
                    <p className="stat-label">Perdem com todas</p>
                    <p className="stat-value negative">{data.counts.loss}</p>
                    <p className="small muted">soma {f.signedMoney(sumOf('loss').toFixed(2))}</p>
                  </div>
                  <div>
                    <p className="stat-label">Resultados mistos</p>
                    <p className="stat-value">{data.counts.mixed}</p>
                    <p className="small muted">de {data.counts.total} instrumentos</p>
                  </div>
                  <div>
                    <p className="stat-label">Orçamento</p>
                    <p className="stat-value">{data.budget ? f.money(data.budget, 'EUR', 0) : '—'}</p>
                    <p className="small muted">por compra, em cada estratégia</p>
                  </div>
                </div>
              </section>

              <div>
                <label htmlFor="wl-q" className="visually-hidden">Filtrar por designação ou símbolo</label>
                <input id="wl-q" className="input" type="search" placeholder="Filtrar por designação ou símbolo (ex.: banco, SAN, Lufthansa)"
                  value={q} onChange={(e) => setQ(e.target.value)} />
              </div>

              {error && <Notice tone="error">{error}</Notice>}
              <GroupTable id="wl-gain" title="Ganham com todas as estratégias" tone="gain" rows={filtered.gain} strategies={data.strategies} initialDir="desc"
                pendingIds={pendingIds} onToggle={toggle}
                bulk={(() => {
                  const toAdd = filtered.gain.filter((r) => !r.inWatchlist);
                  return toAdd.length > 0 && (
                    <Button size="small" onClick={() => setBulk({ action: 'add', rows: toAdd })}>
                      <Icon name="plus" size={16} />Adicionar à lista ({toAdd.length})
                    </Button>
                  );
                })()} />
              <GroupTable id="wl-loss" title="Perdem com todas as estratégias" tone="loss" rows={filtered.loss} strategies={data.strategies} initialDir="asc"
                pendingIds={pendingIds} onToggle={toggle}
                bulk={(() => {
                  const toRemove = filtered.loss.filter((r) => r.inWatchlist);
                  return toRemove.length > 0 && (
                    <Button size="small" variant="danger" className="button-ghost" onClick={() => setBulk({ action: 'remove', rows: toRemove })}>
                      <Icon name="trash" size={16} />Remover da lista ({toRemove.length})
                    </Button>
                  );
                })()}
                note="Acções em queda ou sem tendência, ou com subidas em saltos bruscos: as estratégias de tendência entram em recuperações curtas e saem com perda." />

              <p className="small muted">
                Os mesmos resultados do BackTest ({f.money(data.budget ?? 15000, 'EUR', 0)} por compra, janela de {data.years} anos, sem comissões), calculados às{' '}
                {f.dateTime(data.computedAt)}. O símbolo abre o instrumento; cada resultado abre o gráfico com essa estratégia aplicada; o ícone da última coluna põe ou tira o instrumento de «A minha lista».
              </p>
            </div>
          )}

      <Dialog open={bulk != null} onClose={() => !bulkBusy && setBulk(null)}
        title={bulk?.action === 'add' ? 'Adicionar os ganhadores à minha lista?' : 'Remover os perdedores da minha lista?'}>
        {bulk && (
          <div className="stack" style={{ gap: '1rem' }}>
            <p>
              {bulk.action === 'add'
                ? `Vai acompanhar ${bulk.rows.length} ${bulk.rows.length === 1 ? 'instrumento' : 'instrumentos'} que ganham com todas as estratégias:`
                : `Vai deixar de acompanhar ${bulk.rows.length} ${bulk.rows.length === 1 ? 'instrumento' : 'instrumentos'} que perdem com todas as estratégias:`}
            </p>
            <p className="small muted" style={{ maxHeight: '9rem', overflowY: 'auto' }}>{bulk.rows.map((r) => r.symbol).join(', ')}</p>
            {bulk.action === 'remove' && <p className="small muted">As posições, operações e alertas destes instrumentos não são alterados.</p>}
            <div className="modal-actions">
              <Button onClick={() => setBulk(null)} disabled={bulkBusy}>Cancelar</Button>
              <Button variant={bulk.action === 'add' ? 'primary' : 'danger'} busy={bulkBusy} onClick={runBulk}>
                {bulk.action === 'add' ? `Adicionar ${bulk.rows.length}` : `Remover ${bulk.rows.length}`}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
