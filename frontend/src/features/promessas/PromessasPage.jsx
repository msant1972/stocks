import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Notice, Segmented } from '../../components/ui/controls.jsx';
import SortHeader, { nextSort } from '../../components/ui/SortHeader.jsx';

const DEFAULT_DIR = { rank: 'asc', symbol: 'asc', score: 'desc', m2: 'desc', vol63: 'asc', s200slope: 'desc', r63: 'desc', r252: 'desc', distHigh: 'desc' };
const tone = (v) => (v > 0 ? 'positive' : v < 0 ? 'negative' : '');
/** Percentagem com sinal e as casas indicadas (ex.: +12,4%). */
const fmtPct = (v, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('pt-PT', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
const pctCell = (v, digits = 1) => <span className={`num ${tone(v)}`}>{fmtPct(v * 100, digits)}</span>;

/** Promessas: instrumentos com sinais de continuarem ou passarem a ganhadores nos 12 meses seguintes (GET /promessas). */
export default function PromessasPage() {
  const [params, setParams] = useSearchParams();
  const scope = params.get('lista') === '1' ? 'watchlist' : 'all';
  const showAll = params.get('ver') === 'todos';
  const [sort, setSort] = useState({ key: 'rank', dir: 'asc' });
  const setParam = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v == null) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const q = useQuery({ queryKey: ['promessas', scope], queryFn: () => api.get(`/promessas?scope=${scope}`), staleTime: 5 * 60_000 });
  const data = q.data;

  const rows = useMemo(() => {
    if (!data) return [];
    const base = showAll || scope === 'watchlist' ? data.items : data.items.filter((i) => i.rank <= data.topN);
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      const va = a[sort.key]; const vb = b[sort.key];
      const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return c * sign || a.rank - b.rank;
    });
  }, [data, showAll, scope, sort]);

  const header = (label, key, extra) => (
    <SortHeader label={label} sortKey={key} sort={sort} onSort={(k) => setSort(nextSort(sort, k, DEFAULT_DIR))} {...extra} />
  );
  const avg = (k) => data.validation.reduce((s, v) => s + v[k], 0) / data.validation.length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Promessas</h1>
          <p className="page-sub">
            Instrumentos que, nos últimos 3 meses, mostram os sinais que no passado anunciaram ganhadores nos 12 meses seguintes.
            Ganhadores do passado nem sempre continuam a sê-lo: esta lista mede probabilidades, não certezas.
          </p>
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          {scope === 'all' && (
            <Segmented label="Mostrar" value={showAll ? 'all' : 'top'} onChange={(v) => setParam('ver', v === 'all' ? 'todos' : null)}
              options={[{ value: 'top', label: `Top ${data?.topN ?? 30}` }, { value: 'all', label: 'Todos os elegíveis' }]} />
          )}
          <Segmented label="Instrumentos" value={scope} onChange={(v) => setParam('lista', v === 'watchlist' ? '1' : null)}
            options={[{ value: 'all', label: 'Todos' }, { value: 'watchlist', label: 'A minha lista' }]} />
        </div>
      </div>

      {q.isPending ? <section className="card"><Loading rows={8} label="A calcular os sinais de todos os instrumentos…" /></section>
        : q.error ? <section className="card"><ErrorState error={q.error} onRetry={q.refetch} /></section>
          : (
            <div className="stack">
              <section className="card" aria-labelledby="pr-how">
                <h2 id="pr-how" className="card-title" style={{ marginBottom: '0.75rem' }}>Como é feita a lista</h2>
                <div className="pr-how">
                  <div>
                    <p className="stat-label">Condição (últimos 3 meses)</p>
                    <p className="small">Fecho acima da média de 200 sessões, média de 50 acima da de 200 e rendimento de 3 meses positivo: a tendência mantém-se.</p>
                  </div>
                  <div>
                    <p className="stat-label">Pontuação (0 a 100)</p>
                    <p className="small">Comparação com todo o catálogo: momento de 12 meses ajustado ao risco (M2, peso duplo), volatilidade baixa nos últimos 3 meses e média de 200 sessões a subir.</p>
                  </div>
                  <div>
                    <p className="stat-label">Resultado no passado</p>
                    <p className="small">
                      Aplicada em {data.validation.length} datas anteriores, só com os dados de cada data, os {data.topN} primeiros tiveram em média{' '}
                      <strong>{Math.round(avg('topWinners'))}%</strong> de ganhadores nas três estratégias (catálogo: {Math.round(avg('catalogWinners'))}%) e{' '}
                      <strong>{fmtPct(avg('topReturn'), 0)}</strong> de rendimento (catálogo: {fmtPct(avg('catalogReturn'), 0)}).
                    </p>
                  </div>
                </div>
                <details className="small" style={{ marginTop: '0.75rem' }}>
                  <summary>Validação por período</summary>
                  <div className="table-wrap" style={{ marginTop: '0.5rem' }} tabIndex={0} aria-label="Validação histórica">
                    <table className="data">
                      <thead>
                        <tr>
                          <th scope="col">Lista feita em</th>
                          <th scope="col">Resultado até</th>
                          <th scope="col" className="r">Ganhadores nas 3: top {data.topN}</th>
                          <th scope="col" className="r">Catálogo</th>
                          <th scope="col" className="r">Rendimento: top {data.topN}</th>
                          <th scope="col" className="r">Catálogo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.validation.map((v) => (
                          <tr key={`${v.from}-${v.to}`}>
                            <td>{f.date(v.from)}</td>
                            <td>{f.date(v.to)}</td>
                            <td className="r num" style={{ fontWeight: 600 }}>{v.topWinners}%</td>
                            <td className="r num muted">{v.catalogWinners}%</td>
                            <td className={`r num ${tone(v.topReturn)}`} style={{ fontWeight: 600 }}>{fmtPct(v.topReturn, 0)}</td>
                            <td className={`r num ${tone(v.catalogReturn)}`}>{fmtPct(v.catalogReturn, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted" style={{ marginTop: '0.5rem' }}>
                    Na lista de abril de 2026 a vantagem quase desapareceu: os ganhadores do período anterior inverteram. Com três anos de dados,
                    estas janelas sobrepõem-se e não substituem uma validação mais longa.
                  </p>
                </details>
              </section>

              <section className="card" aria-labelledby="pr-list">
                <div className="card-head">
                  <h2 id="pr-list" className="card-title">{scope === 'watchlist' ? 'Elegíveis da minha lista' : showAll ? 'Todos os elegíveis' : `As ${data.topN} promessas`}</h2>
                  <span className="small muted">
                    {data.counts.eligible} elegíveis de {data.counts.ranked} instrumentos · sinais de {data.asOf ? f.date(data.asOf) : '—'}
                  </span>
                </div>
                {rows.length === 0 ? (
                  <EmptyState title="Sem instrumentos elegíveis" action={scope === 'watchlist' ? <Link className="button" to="/promessas">Ver todo o catálogo</Link> : null}>
                    {scope === 'watchlist' ? 'Nenhum instrumento da sua lista cumpre a condição dos últimos 3 meses.' : 'Nenhum instrumento cumpre a condição dos últimos 3 meses.'}
                  </EmptyState>
                ) : (
                  <div className="table-wrap" tabIndex={0} aria-label="Lista de promessas">
                    <table className="data">
                      <thead>
                        <tr>
                          {header('#', 'rank', { align: 'r' })}
                          {header('Instrumento', 'symbol')}
                          {header('Pontuação', 'score', { title: '0 a 100, comparado com todo o catálogo' })}
                          {header('M2', 'm2', { align: 'r', title: 'Momento de 12 meses (sem o último) dividido pela volatilidade anual' })}
                          {header('Volat. 3m', 'vol63', { align: 'r', title: 'Desvio-padrão anualizado dos retornos diários dos últimos 3 meses' })}
                          {header('SMA200 3m', 's200slope', { align: 'r', title: 'Variação da média de 200 sessões nos últimos 3 meses' })}
                          {header('3 meses', 'r63', { align: 'r' })}
                          {header('12 meses', 'r252', { align: 'r' })}
                          {header('Do máximo', 'distHigh', { align: 'r', title: 'Distância ao máximo de 52 semanas' })}
                          <th scope="col" title="Ganhou com todas as estratégias nos últimos 2 anos (WinnersLoosers)">Nas 3</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.instrumentId}>
                            <td className="r num muted">{r.rank}</td>
                            <td>
                              <Link to={`/instrumentos/${r.instrumentId}`} className="row-link">{r.symbol}</Link>
                              <div className="small muted cx-name">{[r.name, r.exchange].filter(Boolean).join(' · ')}</div>
                            </td>
                            <td>
                              <div className="pr-score" title={`${r.score} de 100`}>
                                <span className="pr-bar"><span style={{ width: `${r.score}%` }} /></span>
                                <span className="num">{r.score.toLocaleString('pt-PT', { minimumFractionDigits: 1 })}</span>
                              </div>
                            </td>
                            <td className="r num">{r.m2.toLocaleString('pt-PT', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</td>
                            <td className="r num">{(r.vol63 * 100).toLocaleString('pt-PT', { maximumFractionDigits: 0 })}%</td>
                            <td className="r">{pctCell(r.s200slope)}</td>
                            <td className="r">{pctCell(r.r63)}</td>
                            <td className="r">{pctCell(r.r252, 0)}</td>
                            <td className="r">{pctCell(r.distHigh)}</td>
                            <td>{r.pastWinner ? <span className="badge badge-positive">Sim</span> : <span className="small muted">Não</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <Notice>
                Simulação estatística sobre dados diários dos últimos três anos, com acções que existem hoje no catálogo. Uma pontuação alta
                indica sinais que no passado foram seguidos mais vezes por subidas; não garante resultados futuros e não é uma recomendação
                de investimento. Calculado às {f.dateTime(data.computedAt)}.
              </Notice>
            </div>
          )}
    </>
  );
}
