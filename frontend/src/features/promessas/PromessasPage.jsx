import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Notice, Segmented } from '../../components/ui/controls.jsx';
import SortHeader, { nextSort } from '../../components/ui/SortHeader.jsx';
import WatchButton from '../../components/finance/WatchButton.jsx';
import { useToast } from '../../components/feedback/Toast.jsx';
import { keys } from '../../lib/queries.js';

const DEFAULT_DIR = { rank: 'asc', symbol: 'asc', score: 'desc', m2: 'desc', s200slope: 'desc', s50over200: 'desc', upDays63: 'desc', liq: 'desc', r63: 'desc', r252: 'desc', distHigh: 'desc', setup: 'asc', bestTotal: 'desc' };
/** Onde está o preço agora: diz que tipo de entrada é mais provável (não entra na pontuação). */
const SETUP = {
  pullback: { label: 'Em recuo', tone: 'badge-accent', help: 'RSI14 abaixo de 45 ou 5 % ou mais abaixo do máximo de 20 sessões: é onde compram as estratégias de mergulho e de ondas (F-Mergulho, E-Ondas)' },
  high: { label: 'Perto do máximo', tone: 'badge-positive', help: 'A 3 % ou menos do máximo de 52 semanas: é onde compram as estratégias de momentum e de rotura (A-Momentum, C-AI)' },
  mid: { label: 'A meio', tone: '', help: 'Entre o recuo e o máximo' },
};
const tone = (v) => (v > 0 ? 'positive' : v < 0 ? 'negative' : '');
/** Percentagem com sinal e as casas indicadas (ex.: +12,4%). */
const fmtPct = (v, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('pt-PT', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
const pctCell = (v, digits = 1) => <span className={`num ${tone(v)}`}>{fmtPct(v * 100, digits)}</span>;

/** Promessas: instrumentos com mais probabilidade de darem oportunidades de negociação às estratégias nos meses seguintes (GET /promessas). */
export default function PromessasPage() {
  const [params, setParams] = useSearchParams();
  const scope = params.get('lista') === '1' ? 'watchlist' : 'all';
  const showAll = params.get('ver') === 'todos';
  const [sort, setSort] = useState({ key: 'rank', dir: 'asc' });
  const [setupFilter, setSetupFilter] = useState('all');
  const [pending, setPending] = useState(new Set());
  const qc = useQueryClient();
  const toast = useToast();
  const setParam = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v == null) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const q = useQuery({ queryKey: ['promessas', scope], queryFn: () => api.get(`/promessas?scope=${scope}`), staleTime: 5 * 60_000 });
  const data = q.data;

  const rows = useMemo(() => {
    if (!data) return [];
    const base = (showAll || scope === 'watchlist' ? data.items : data.items.filter((i) => i.rank <= data.topN))
      .filter((i) => setupFilter === 'all' || i.setup === setupFilter);
    const sign = sort.dir === 'asc' ? 1 : -1;
    const val = (r) => (sort.key === 'bestTotal' ? r.best?.total ?? -Infinity : r[sort.key]);
    return [...base].sort((a, b) => {
      const va = val(a); const vb = val(b);
      const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return c * sign || a.rank - b.rank;
    });
  }, [data, showAll, scope, sort, setupFilter]);

  async function toggle(row) {
    setPending((p) => new Set(p).add(row.instrumentId));
    try {
      if (row.inWatchlist) await api.del(`/watchlist/items/${row.instrumentId}`);
      else await api.post('/watchlist/items', { instrumentId: row.instrumentId });
      await Promise.all([qc.invalidateQueries({ queryKey: ['promessas'] }), qc.invalidateQueries({ queryKey: keys.watchlist })]);
      qc.invalidateQueries({ queryKey: ['instruments'] });
      toast(row.inWatchlist ? `${row.symbol} removido da minha lista` : `${row.symbol} adicionado à minha lista`);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(row.instrumentId); return n; });
    }
  }

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
            Instrumentos com mais probabilidade de darem oportunidades de negociação às estratégias nos meses seguintes: tendência longa
            intacta, liquidez e subida regular. Junte-os à sua lista para a Automação e os Sinais os acompanharem. Mede probabilidades, não certezas.
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
                    <p className="small">Comparação com todo o catálogo: momento de 12 meses ajustado ao risco (M2), média de 200 sessões a subir e média de 50 acima da de 200 (peso 1 cada), mais liquidez e sessões a subir nos últimos 3 meses (peso ½ cada).</p>
                  </div>
                  <div>
                    <p className="stat-label">Resultado no passado</p>
                    <p className="small">
                      Aplicada em {data.validation.length} datas anteriores, só com os dados de cada data, os {data.topN} primeiros tiveram em média{' '}
                      <strong>{Math.round(avg('topWinners'))}%</strong> de ganhadores em todas as estratégias (catálogo: {Math.round(avg('catalogWinners'))}%) e{' '}
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
                          <th scope="col" className="r">Ganhadores em todas: top {data.topN}</th>
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
                    {data.validatedAt
                      ? `Recalculada semanalmente com o histórico disponível (última vez: ${f.dateTime(data.validatedAt)}), com todas as estratégias disponíveis.`
                      : 'Validação inicial (24 out. 2026), com as três estratégias de então; na lista de abril de 2026 a vantagem quase desapareceu.'}{' '}
                    As janelas sobrepõem-se e não substituem uma validação mais longa.
                  </p>
                </details>
                <p className="small muted" style={{ margin: '0.75rem 0 0' }}>
                  Pontuação revista a 14 nov. 2026 e testada em 42 datas mensais (jan. 2023 a abr. 2026): nos 6 meses seguintes, as estratégias ligadas
                  ganharam em média 2 184 € por estratégia nos 30 primeiros, contra 862 € no catálogo (1 566 € com a pontuação anterior), e os 30 primeiros
                  bateram o catálogo em 37 das 42 datas. «Momento» diz onde está o preço agora: em recuo compram as estratégias de mergulho, perto do
                  máximo as de momentum.
                </p>
              </section>

              <section className="card" aria-labelledby="pr-list">
                <div className="card-head">
                  <h2 id="pr-list" className="card-title">{scope === 'watchlist' ? 'Elegíveis da minha lista' : showAll ? 'Todos os elegíveis' : `As ${data.topN} promessas`}</h2>
                  <span className="small muted">
                    {data.counts.eligible} elegíveis de {data.counts.ranked} instrumentos · sinais de {data.asOf ? f.date(data.asOf) : '—'}
                  </span>
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <Segmented label="Momento" value={setupFilter} onChange={setSetupFilter}
                    options={[{ value: 'all', label: 'Todos' }, { value: 'pullback', label: 'Em recuo' }, { value: 'high', label: 'Perto do máximo' }, { value: 'mid', label: 'A meio' }]} />
                </div>
                {rows.length === 0 ? (
                  <EmptyState title="Sem instrumentos elegíveis" action={scope === 'watchlist' ? <Link className="button" to="/promessas">Ver todo o catálogo</Link> : null}>
                    {setupFilter !== 'all' ? 'Nenhum elegível neste momento do preço; escolha «Todos».' : scope === 'watchlist' ? 'Nenhum instrumento da sua lista cumpre a condição dos últimos 3 meses.' : 'Nenhum instrumento cumpre a condição dos últimos 3 meses.'}
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
                          {header('SMA200 3m', 's200slope', { align: 'r', title: 'Variação da média de 200 sessões nos últimos 3 meses' })}
                          {header('SMA50/200', 's50over200', { align: 'r', title: 'Distância da média de 50 sessões à de 200' })}
                          {header('Dias a subir', 'upDays63', { align: 'r', title: 'Parte das sessões que fecharam a subir nos últimos 3 meses' })}
                          {header('VT médio', 'liq', { align: 'r', title: 'Valor negociado médio por sessão nas últimas 50 sessões (liquidez)' })}
                          {header('3 meses', 'r63', { align: 'r' })}
                          {header('12 meses', 'r252', { align: 'r' })}
                          {header('Do máximo', 'distHigh', { align: 'r', title: 'Distância ao máximo de 52 semanas' })}
                          {header('Momento', 'setup', { title: 'Onde está o preço agora: em recuo, perto do máximo de 52 semanas ou a meio' })}
                          {header('Melhor estratégia', 'bestTotal', { align: 'r', title: 'A estratégia ligada com melhor resultado no BackTest dos últimos 2 anos: a que a Automação usaria' })}
                          <th scope="col">Minha lista</th>
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
                            <td className="r">{pctCell(r.s200slope)}</td>
                            <td className="r">{pctCell(r.s50over200)}</td>
                            <td className="r num">{Math.round(r.upDays63 * 100)}%</td>
                            <td className="r num">{f.compactMoney(r.liq)}</td>
                            <td className="r">{pctCell(r.r63)}</td>
                            <td className="r">{pctCell(r.r252, 0)}</td>
                            <td className="r">{pctCell(r.distHigh)}</td>
                            <td><span className={`badge ${SETUP[r.setup].tone}`} title={SETUP[r.setup].help}>{SETUP[r.setup].label}</span></td>
                            <td className="r">
                              {r.best
                                ? <><Link to={`/charts?instrumento=${r.instrumentId}&estrategia=${r.best.strategyId}`} className="row-link">{r.best.name}</Link><div className="small positive num">{f.signedMoney(r.best.total)}</div></>
                                : <span className="small muted">Nenhuma ganha</span>}
                            </td>
                            <td><WatchButton row={r} inWatchlist={r.inWatchlist} busy={pending.has(r.instrumentId)} onToggle={toggle} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <Notice>
                Estatística sobre dados diários dos últimos cinco anos, com acções que existem hoje no catálogo e num período de subida
                generalizada. Uma pontuação alta indica sinais que no passado foram seguidos mais vezes por operações com ganho; não garante
                resultados futuros e não é uma recomendação de investimento. Calculado às {f.dateTime(data.computedAt)}.
              </Notice>
            </div>
          )}
    </>
  );
}
