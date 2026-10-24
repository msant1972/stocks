import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { PnL } from '../../components/finance/finance.jsx';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Segmented } from '../../components/ui/controls.jsx';
import SortHeader, { nextSort } from '../../components/ui/SortHeader.jsx';

const SORT_DEFAULT_DIR = { symbol: 'asc', total: 'desc', totalPct: 'desc', closed: 'desc', winRate: 'desc', buyHoldPnl: 'desc', edge: 'desc' };

const winRate = (i) => (i.closed ? i.wins / i.closed : null);
const edge = (i) => (i.buyHoldPnl == null ? null : i.total - i.buyHoldPnl);
const VALUE = {
  symbol: (i) => i.symbol,
  total: (i) => i.total,
  totalPct: (i) => i.totalPct,
  closed: (i) => i.closed,
  winRate,
  buyHoldPnl: (i) => i.buyHoldPnl,
  edge,
};

/** Ordena; sem valor fica sempre no fim. */
function sortRows(rows, { key, dir }) {
  const value = VALUE[key];
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null || vb == null) return (va == null) - (vb == null) || a.symbol.localeCompare(b.symbol);
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return c * sign || a.symbol.localeCompare(b.symbol);
  });
}

const pctTone = (v) => (v > 0 ? 'positive' : v < 0 ? 'negative' : '');
const Pct = ({ value }) => (value == null ? <span className="muted">—</span> : <span className={`num ${pctTone(value)}`}>{f.pct(value.toFixed(2))}</span>);

function Stat({ label, value, hint, tone }) {
  return (
    <div>
      <p className="stat-label">{label}</p>
      <p className={`stat-value ${tone ?? ''}`}>{value}</p>
      {hint && <p className="small muted">{hint}</p>}
    </div>
  );
}

/** Resultado da estratégia de momento em cada instrumento nos últimos 2 anos (GET /backtest). */
export default function BacktestPage() {
  const [params, setParams] = useSearchParams();
  const scope = params.get('lista') === '1' ? 'watchlist' : 'all';
  const [q, setQ] = useState('');
  const sort = { key: SORT_DEFAULT_DIR[params.get('ordem')] ? params.get('ordem') : 'total', dir: params.get('sentido') === 'asc' ? 'asc' : params.get('sentido') === 'desc' ? 'desc' : null };
  if (!sort.dir) sort.dir = SORT_DEFAULT_DIR[sort.key];
  const setParam = (changes) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(changes)) { if (v == null) next.delete(k); else next.set(k, v); }
    return next;
  }, { replace: true });
  const onSort = (key) => {
    const s = nextSort(sort, key, SORT_DEFAULT_DIR);
    setParam(s.key === 'total' && s.dir === 'desc' ? { ordem: null, sentido: null } : { ordem: s.key, sentido: s.dir });
  };

  const bt = useQuery({ queryKey: ['backtest', scope], queryFn: () => api.get(`/backtest?scope=${scope}`), staleTime: 5 * 60_000 });
  const items = bt.data?.items;

  const stats = useMemo(() => {
    if (!items) return null;
    const traded = items.filter((i) => i.closed > 0 || i.openPosition);
    const gains = traded.filter((i) => i.total > 0).length;
    const losses = traded.filter((i) => i.total < 0).length;
    const beat = traded.filter((i) => i.buyHoldPnl != null && i.total > i.buyHoldPnl).length;
    return { traded: traded.length, gains, losses, beat, sum: traded.reduce((s, i) => s + i.total, 0) };
  }, [items]);

  const rows = useMemo(() => {
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    const filtered = needle ? items.filter((i) => i.symbol.toLowerCase().includes(needle) || (i.name ?? '').toLowerCase().includes(needle)) : items;
    return sortRows(filtered, sort);
  }, [items, q, sort.key, sort.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (label, key, extra) => <SortHeader label={label} sortKey={key} sort={sort} onSort={onSort} {...extra} />;
  const pctOf = (n, d) => (d ? ` · ${Math.round((n / d) * 100)}%` : '');

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">BackTest</h1>
          <p className="page-sub">
            A estratégia de momento aplicada a cada instrumento nos últimos 2 anos, para ver onde funciona e onde não funciona.
            Simulação no histórico, sem comissões; não altera a carteira virtual nem é uma recomendação.
          </p>
        </div>
        <Segmented label="Instrumentos" value={scope} onChange={(v) => setParam({ lista: v === 'watchlist' ? '1' : null })}
          options={[{ value: 'all', label: 'Todos' }, { value: 'watchlist', label: 'A minha lista' }]} />
      </div>

      {bt.isPending ? <section className="card"><Loading rows={8} label="A aplicar a estratégia a todos os instrumentos…" /></section>
        : bt.error ? <section className="card"><ErrorState error={bt.error} onRetry={bt.refetch} /></section>
          : items.length === 0 ? (
            <section className="card">
              <EmptyState title="Sem instrumentos" action={scope === 'watchlist' ? <Link className="button" to="/acompanhar">Acompanhar instrumentos</Link> : null}>
                {scope === 'watchlist' ? 'A sua lista não tem instrumentos activos.' : 'Ainda não há instrumentos activos com cotações.'}
              </EmptyState>
            </section>
          ) : (
            <div className="stack">
              <section className="card" aria-labelledby="bt-summary">
                <h2 id="bt-summary" className="visually-hidden">Resumo</h2>
                <div className="stats" style={{ marginTop: 0 }}>
                  <Stat label="Instrumentos com operações" value={`${stats.traded} de ${items.length}`} />
                  <Stat label="Com ganho" value={`${stats.gains}${pctOf(stats.gains, stats.traded)}`} tone="positive" />
                  <Stat label="Com perda" value={`${stats.losses}${pctOf(stats.losses, stats.traded)}`} tone="negative" />
                  <Stat label="Melhor que comprar e manter" value={`${stats.beat}${pctOf(stats.beat, stats.traded)}`} />
                  <Stat label="Soma dos resultados" value={<PnL value={stats.sum.toFixed(2)} />}
                    hint={`${bt.data.budget.toLocaleString('pt-PT')} € por compra e por reforço`} />
                </div>
              </section>

              <section className="card" aria-labelledby="bt-table">
                <div className="card-head">
                  <h2 id="bt-table" className="card-title">Resultado por instrumento</h2>
                  <span className="small muted">{rows.length} {rows.length === 1 ? 'instrumento' : 'instrumentos'}</span>
                </div>
                <div style={{ marginBottom: '1rem' }}>
                  <label htmlFor="bt-q" className="visually-hidden">Filtrar por designação ou símbolo</label>
                  <input id="bt-q" className="input" type="search" placeholder="Filtrar por designação ou símbolo"
                    value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <div className="table-wrap" tabIndex={0} aria-label="Tabela de resultados da estratégia">
                  <table className="data">
                    <thead>
                      <tr>
                        {header('Instrumento', 'symbol')}
                        {header('Resultado', 'total', { align: 'r', title: 'Realizado (operações fechadas) + não realizado (posição aberta ao último fecho)' })}
                        {header('%', 'totalPct', { align: 'r', title: 'Resultado sobre o capital máximo investido em simultâneo (com reforços pode exceder uma compra)' })}
                        {header('Operações', 'closed', { align: 'r', title: 'Operações fechadas (compra e venda); reforços entre parênteses' })}
                        {header('Acerto', 'winRate', { align: 'r', title: 'Operações fechadas com ganho' })}
                        <th scope="col">Posição</th>
                        {header('Comprar e manter', 'buyHoldPnl', { align: 'r', title: 'Uma compra no início do período, mantida até ao último fecho' })}
                        {header('Diferença', 'edge', { align: 'r', title: 'Resultado da estratégia − comprar e manter' })}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((i) => {
                        const wr = winRate(i);
                        const e = edge(i);
                        return (
                          <tr key={i.instrumentId}>
                            <td>
                              <Link to={`/instrumentos/${i.instrumentId}?estrategia=1`} className="row-link" title="Ver a estratégia no gráfico">{i.symbol}</Link>
                              <div className="small muted">{[i.name, i.exchange].filter(Boolean).join(' · ')}</div>
                            </td>
                            <td className="r"><PnL value={i.total.toFixed(2)} /></td>
                            <td className="r"><Pct value={i.closed || i.openPosition ? i.totalPct : null} /></td>
                            <td className="r num">{i.closed}{i.reinforcements > 0 && <span className="small muted"> (+{i.reinforcements})</span>}</td>
                            <td className="r num">{wr == null ? <span className="muted">—</span> : `${i.wins}/${i.closed} · ${Math.round(wr * 100)}%`}</td>
                            <td>{i.openPosition && <span className="badge" title={`Não realizado: ${f.signedMoney(i.unrealized.toFixed(2))}`}>Aberta</span>}</td>
                            <td className="r">
                              {i.buyHoldPnl == null ? <span className="muted">—</span> : <><PnL value={i.buyHoldPnl.toFixed(2)} /><div className="small"><Pct value={i.buyHoldPct} /></div></>}
                            </td>
                            <td className="r">{e == null ? <span className="muted">—</span> : <PnL value={e.toFixed(2)} />}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="small muted" style={{ marginTop: '1rem' }}>
                  Regras: compra de {bt.data.budget.toLocaleString('pt-PT')} € quando o SMA10/SMA200 desce-sobe-sobe; reforço de mais{' '}
                  {bt.data.budget.toLocaleString('pt-PT')} € a cada +10% desde a última compra; venda quando sobe-desce-desce com o SMA8/SMA125
                  abaixo de 1%; sinais ignorados com o SMA10/SMA200 entre −1% e +1%. Execução ao fecho da sessão do sinal. Calculado às{' '}
                  {f.dateTime(bt.data.computedAt)} com as cotações da última recolha. O símbolo abre o gráfico com a estratégia aplicada.
                </p>
              </section>
            </div>
          )}
    </>
  );
}
