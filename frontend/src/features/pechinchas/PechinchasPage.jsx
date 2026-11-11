import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import { keys, useWatchlist } from '../../lib/queries.js';
import * as f from '../../lib/format.js';
import { metricValue, signedPctOf } from '../../lib/company.js';
import { bargainCriteria, sortBargains } from '../../lib/bargains.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { useToast } from '../../components/feedback/Toast.jsx';
import WatchButton from '../../components/finance/WatchButton.jsx';
import { Notice } from '../../components/ui/controls.jsx';
import SortHeader, { nextSort } from '../../components/ui/SortHeader.jsx';

const DEFAULT_DIR = { symbol: 'asc', sector: 'asc', cheap: 'desc', pe: 'asc', dividendYield: 'desc', upside: 'desc', grahamGap: 'asc' };

/**
 * Pechinchas: instrumentos com o veredicto «Barato» na valorização do painel Empresa (maioria dos critérios sector,
 * P/E histórico, analistas e Graham). O filtro do sector fica no endereço (?sector=).
 */
export default function PechinchasPage() {
  const q = useQuery({ queryKey: ['valuations', 'cheap'], queryFn: () => api.get('/valuations?verdict=cheap'), staleTime: 15 * 60_000 });
  const [params, setParams] = useSearchParams();
  const sector = params.get('sector') ?? '';
  const [sort, setSort] = useState({ key: 'cheap', dir: 'desc' });
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const sectors = useMemo(() => [...new Set(items.map((r) => r.sector).filter(Boolean))].sort(), [items]);
  const rows = useMemo(() => sortBargains(items.filter((r) => !sector || r.sector === sector), sort), [items, sector, sort]);
  const onSort = (key) => setSort(nextSort(sort, key, DEFAULT_DIR));
  const header = (label, key, extra) => <SortHeader label={label} sortKey={key} sort={sort} onSort={onSort} {...extra} />;
  // «A minha lista»: o estado de cada linha vem da lista do utilizador (a valorização é partilhada por todos).
  const watchlist = useWatchlist();
  const mine = useMemo(() => new Set((watchlist.data?.items ?? []).map((i) => i.id)), [watchlist.data]);
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState(new Set());
  const [watchError, setWatchError] = useState(null);
  async function toggle(row) {
    const inList = mine.has(row.instrumentId);
    setWatchError(null);
    setPending((s) => new Set(s).add(row.instrumentId));
    try {
      if (inList) await api.del(`/watchlist/items/${row.instrumentId}`);
      else await api.post('/watchlist/items', { instrumentId: row.instrumentId });
      await qc.invalidateQueries({ queryKey: keys.watchlist });
      qc.invalidateQueries({ queryKey: ['instruments'] });
      qc.invalidateQueries({ queryKey: ['winners-losers'] });
      toast(inList ? `${row.symbol} removido da minha lista` : `${row.symbol} adicionado à minha lista`);
    } catch (err) {
      setWatchError(errorMessage(err));
    } finally {
      setPending((s) => { const n = new Set(s); n.delete(row.instrumentId); return n; });
    }
  }
  const setSector = (v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set('sector', v); else n.delete('sector'); return n; }, { replace: true });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Pechinchas</h1>
          <p className="page-sub">
            Instrumentos que a valorização do painel Empresa classifica como «Barato»: a maioria dos critérios com dados (sector, P/E
            face à própria história, preço-alvo dos analistas e número de Graham) diz barato. Indicativo, não é uma recomendação.
          </p>
        </div>
        {sectors.length > 1 && (
          <div className="row" style={{ alignItems: 'center' }}>
            <label htmlFor="pe-sector" className="small muted">Sector</label>
            <select id="pe-sector" className="select" value={sector} onChange={(e) => setSector(e.target.value)} style={{ width: 'auto' }}>
              <option value="">Todos</option>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
      </div>

      <section className="card" aria-labelledby="pe-title">
        <div className="card-head">
          <h2 id="pe-title" className="card-title">Classificados como barato</h2>
          {!q.isPending && !q.error && <span className="small muted">{rows.length} {rows.length === 1 ? 'instrumento' : 'instrumentos'}</span>}
        </div>
        {watchError && <Notice tone="error">{watchError}</Notice>}
        {q.isPending ? <Loading rows={8} label="A calcular a valorização de todos os instrumentos…" />
          : q.error ? <ErrorState error={q.error} onRetry={q.refetch} />
            : rows.length === 0 ? <EmptyState title="Nenhuma pechincha">Nenhum instrumento está classificado como barato{sector ? ' neste sector' : ''}.</EmptyState>
              : (
                <div className="table-wrap" tabIndex={0} aria-label="Pechinchas">
                  <table className="data">
                    <thead>
                      <tr>
                        {header('Instrumento', 'symbol')}
                        {header('Sector', 'sector')}
                        {header('Critérios', 'cheap', { title: 'Critérios que dizem barato, de entre os que têm dados' })}
                        <th scope="col" className="r">Fecho</th>
                        {header('P/E', 'pe', { align: 'r', title: 'P/E ao último fecho e mediana do sector' })}
                        {header('Dividendo', 'dividendYield', { align: 'r', title: 'Rendimento do dividendo dos últimos 12 meses' })}
                        {header('Alvo analistas', 'upside', { align: 'r', title: 'Preço-alvo médio dos analistas face ao fecho' })}
                        {header('Graham', 'grahamGap', { align: 'r', title: 'Fecho face ao número de Graham (negativo = abaixo)' })}
                        <th scope="col" className="r" title="Adicionar à ou remover da minha lista">Minha lista</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.instrumentId}>
                          <td>
                            <Link to={`/instrumentos/${r.instrumentId}`} className="row-link">{r.symbol}</Link>
                            <div className="small muted cx-name" title={r.name ?? undefined}>{[r.name, r.exchange].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className="small">{r.sector ?? '—'}</td>
                          <td>
                            <strong className="num">{r.cheap} de {r.total}</strong>
                            <div className="small muted">{bargainCriteria(r.criteria)}</div>
                          </td>
                          <td className="r num">{f.price(r.price, r.currency || 'EUR')}</td>
                          <td className="r num">
                            {metricValue('pe', r.pe)}
                            {r.sectorPe != null && <div className="small muted">sector {metricValue('pe', r.sectorPe)}</div>}
                          </td>
                          <td className="r num">{metricValue('dividendYield', r.dividendYield)}</td>
                          <td className="r num">
                            {signedPctOf(r.upside)}
                            {r.analysts > 0 && <div className="small muted">{r.analysts} analistas</div>}
                          </td>
                          <td className="r num">{signedPctOf(r.grahamGap)}</td>
                          <td className="r">
                            {watchlist.isPending ? <span className="muted" aria-label="A carregar">…</span>
                              : <WatchButton row={r} inWatchlist={mine.has(r.instrumentId)} busy={pending.has(r.instrumentId)} onToggle={toggle} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        <p className="small muted" style={{ margin: '0.75rem 0 0' }}>
          Dados da empresa do Yahoo Finance (actualizados uma vez por semana) com o último fecho. O detalhe de cada critério está no painel
          Empresa do Charts. O ícone da última coluna põe ou tira o instrumento de «A minha lista».
        </p>
      </section>
    </>
  );
}
