import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { keys, useCatalog } from '../../lib/queries.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Button, Field, Notice } from '../../components/ui/controls.jsx';
import InstrumentLogo from '../../components/ui/InstrumentLogo.jsx';
import WatchButton from '../../components/finance/WatchButton.jsx';
import { bySector, pct1, reviewState, signedPct, tone } from './format.js';
import { startError, useStartDate } from '../../lib/startDate.js';

const PortfolioChart = lazy(() => import('./PortfolioChart.jsx'));

const REASONS = {
  ranking: { label: 'Saiu dos melhores', help: 'Deixou de estar entre os melhores do ranking e há um substituto melhor' },
  filtro: { label: 'Perdeu a tendência', help: 'Deixou de cumprir a tendência (fecho e SMA50 acima da SMA200, 3 meses positivos) ou a liquidez mínima' },
};

/** Uma das três listas da revisão (comprar, manter, vender). */
function PickTable({ id, title, hint, items, empty, kind, logoVersions, pending, onToggle }) {
  const selling = kind === 'sell';
  return (
    <div>
      <h3 id={id} className="card-title" style={{ fontSize: '1rem' }}>{title} <span className="muted small">({items.length})</span></h3>
      <p className="small muted" style={{ margin: '0.125rem 0 0.5rem' }}>{hint}</p>
      {items.length === 0 ? <p className="small muted">{empty}</p> : (
        <div className="table-wrap" tabIndex={0} aria-labelledby={id}>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Instrumento</th>
                <th scope="col" className="r">Lugar</th>
                <th scope="col" className="r">Último fecho</th>
                {selling ? <th scope="col">Motivo</th> : <th scope="col" className="r">Peso</th>}
                <th scope="col" className="r">Desde a entrada</th>
                <th scope="col"><span className="visually-hidden">Minha lista</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.instrumentId}>
                  <td>
                    <div className="logo-cell">
                      <InstrumentLogo instrumentId={x.instrumentId} logoVersion={logoVersions.get(x.instrumentId)} size={28} />
                      <div>
                        <Link to={`/charts?instrumento=${x.instrumentId}`} className="row-link">{x.symbol}</Link>
                        <div className="small muted">{x.name}{x.sector ? ` · ${x.sector}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="r num">{x.rank ?? '—'}</td>
                  <td className="r num">{x.close == null ? '—' : f.money(x.close)}</td>
                  {selling
                    ? <td><span className="badge" title={REASONS[x.reason].help}>{REASONS[x.reason].label}</span></td>
                    : <td className="r num">{x.weight == null ? '—' : pct1(x.weight * 100)}</td>}
                  <td className="r">
                    <span className={`num ${tone(x.pnlPct)}`}>{signedPct(x.pnlPct)}</span>
                    {x.buyDate && <div className="small muted">{f.date(x.buyDate)}{x.sellDate ? ` a ${f.date(x.sellDate)}` : ''}</div>}
                  </td>
                  <td><WatchButton row={x} inWatchlist={x.inWatchlist} busy={pending.has(x.instrumentId)} onToggle={onToggle} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Portfolio Recomendado: carteira-modelo de 20 instrumentos, revista de duas em duas semanas (GET /recommended-portfolio). Mostra
 * o rendimento dos últimos 24 meses contra o catálogo, as listas a comprar, a manter e a vender da última revisão, a carteira por
 * sector e as revisões anteriores.
 */
export default function RecommendedPortfolioPage() {
  // Data de início gravada na base de dados (por utilizador): a carteira começa vazia nesse dia; sem ela, os últimos 24 meses.
  const saved = useStartDate('recommended-portfolio');
  // A data por omissão pode não caber no histórico (ex.: base sem dados suficientes): a API recusa-a e usa-se o período.
  const [defaultRejected, setDefaultRejected] = useState(false);
  const start = saved.isDefault && defaultRejected ? null : saved.start;
  const [draft, setDraft] = useState(null); // o que está no campo enquanto não é gravado (null: a data gravada)
  const [saveError, setSaveError] = useState(null);
  const [limits, setLimits] = useState({ minStart: null, latestSession: null });
  const q = useQuery({
    queryKey: ['recommended-portfolio', start],
    queryFn: () => api.get(`/recommended-portfolio${start ? `?start=${start}` : ''}`),
    staleTime: 5 * 60_000, placeholderData: (prev) => prev, enabled: saved.ready,
  });
  if (q.error?.code === 'START_OUT_OF_RANGE' && saved.isDefault && start && !defaultRejected) setDefaultRejected(true);
  if (q.data?.minStart && (q.data.minStart !== limits.minStart || q.data.latestSession !== limits.latestSession)) {
    setLimits({ minStart: q.data.minStart, latestSession: q.data.latestSession });
  }
  const shown = draft ?? start ?? '';
  const draftError = startError(shown, limits) ?? saveError;
  const setStart = async (value) => {
    setDraft(value);
    setSaveError(null);
    if (value && startError(value, limits)) return; // fora dos limites: fica no campo, com o erro, sem gravar
    try {
      await saved.save(value);
      setDraft(null);
    } catch (err) {
      setSaveError(errorMessage(err));
    }
  };
  const catalog = useCatalog();
  const logoVersions = new Map((catalog.data?.items ?? []).map((i) => [i.id, i.logoVersion]));
  const [pending, setPending] = useState(new Set());
  const qc = useQueryClient();
  const toast = useToast();
  const r = q.data;
  const s = r?.summary;
  const o = r?.options;

  async function toggle(row) {
    setPending((p) => new Set(p).add(row.instrumentId));
    try {
      if (row.inWatchlist) await api.del(`/watchlist/items/${row.instrumentId}`);
      else await api.post('/watchlist/items', { instrumentId: row.instrumentId });
      await Promise.all([qc.invalidateQueries({ queryKey: ['recommended-portfolio'] }), qc.invalidateQueries({ queryKey: keys.watchlist })]);
      qc.invalidateQueries({ queryKey: ['instruments'] });
      toast(row.inWatchlist ? `${row.symbol} removido da minha lista` : `${row.symbol} adicionado à minha lista`);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(row.instrumentId); return n; });
    }
  }

  const state = reviewState(r?.review);
  const versus = (p) => (p ? <>{signedPct(p.value)} <span className="small muted">catálogo {signedPct(p.benchmark)}</span></> : '—');

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Portfolio Recomendado</h1>
          <p className="page-sub">
            {start
              ? <>Carteira fixa de {o?.positions ?? 20} instrumentos, escolhidos na data de início pela pontuação das Promessas (tendência longa, liquidez e
                regularidade), só entre os que tinham a tendência intacta e com os dados até esse dia, no máximo {o?.maxPerSector ?? 5} por sector, e mantidos
                até hoje sem revisões. Sem data de início («Últimos 24 meses»), a carteira é revista de duas em duas semanas. Simulação sobre cotações diárias, sem ordens.</>
              : <>Carteira-modelo de {o?.positions ?? 20} instrumentos, revista de duas em duas semanas. Em cada revisão ordena o catálogo pela pontuação
                das Promessas (tendência longa, liquidez e regularidade), só entre os instrumentos com a tendência intacta, e diz o que comprar,
                manter e vender: no máximo {o?.maxPerSector ?? 5} por sector, e uma posição só sai quando deixa de estar entre os {o?.keepRank ?? 40} melhores
                ou perde a tendência. Com uma data de início, a carteira é fixa. Simulação sobre cotações diárias, sem ordens.</>}
          </p>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ width: '10.5rem' }}>
            <Field label="Data de início" error={draftError}>
              {(p) => (
                <input {...p} type="date" className="input" value={shown} min={limits.minStart ?? undefined} max={limits.latestSession ?? undefined}
                  onChange={(e) => setStart(e.target.value)} style={{ minHeight: '2.75rem' }}
                  title={limits.minStart ? `A carteira começa vazia nesse dia; a data fica gravada. De ${f.date(limits.minStart)} a ${f.date(limits.latestSession)}.` : 'A carteira começa vazia nesse dia; a data fica gravada.'} />
              )}
            </Field>
          </div>
          {start && <Button variant="ghost" onClick={() => setStart('')} title="Voltar aos últimos 24 meses">Últimos 24 meses</Button>}
        </div>
      </div>

      {q.isPending ? <Loading rows={6} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !r.firstDate ? (
        <EmptyState title="Sem dados para a carteira">Não há instrumentos com histórico suficiente (pelo menos 15 meses de cotações).</EmptyState>
      ) : (
        <>
          <section className="card" aria-labelledby="pr-result" style={{ opacity: q.isFetching ? 0.6 : 1 }}>
            <h2 id="pr-result" className="card-title" style={{ marginBottom: '0.75rem' }}>
              Rendimento {r.start ? `desde ${f.date(r.start)}` : `nos últimos ${r.windowMonths} meses`} · {f.date(r.firstDate)} a {f.date(r.lastDate)}
            </h2>
            <dl className="kpis">
              <div><dt>Portfolio, {r.start ? 'desde o início' : `${r.windowMonths} meses`}</dt><dd className={tone(s.returnPct)}>{signedPct(s.returnPct)}</dd></div>
              <div><dt>Catálogo em partes iguais ({s.benchmarkInstruments})</dt><dd>{signedPct(s.benchmarkPct)}</dd></div>
              <div><dt>Últimos 12 meses</dt><dd>{versus(s.last12)}</dd></div>
              <div><dt>Últimos 6 meses</dt><dd>{versus(s.last6)}</dd></div>
              <div><dt>Últimos 3 meses</dt><dd>{versus(s.last3)}</dd></div>
              <div><dt>Maior queda desde um máximo</dt><dd><span className="negative">{signedPct(s.maxDrawdownPct)}</span> <span className="small muted">catálogo {signedPct(s.benchmarkDrawdownPct)}</span></dd></div>
              {r.start
                ? <div><dt>Posições a ganhar</dt><dd>{r.positions.filter((p) => p.pnlPct > 0).length} de {r.positions.length}</dd></div>
                : <div><dt>Posições fechadas · com ganho</dt><dd>{s.closed} · {s.closed ? pct1((100 * s.wins) / s.closed) : '—'}</dd></div>}
              <div><dt>Custos pagos</dt><dd>{pct1(s.feesPct)}</dd></div>
            </dl>
            {r.curve.length > 1 && <Suspense fallback={<Loading rows={3} />}><PortfolioChart curve={r.curve} /></Suspense>}
            <p className="small muted" style={{ marginTop: '0.75rem' }}>
              Valores com dividendos e depois de custos estimados da SAXO (comissão, spread e custódia), como no BackTest.{' '}
              {r.start
                ? <>Carteira fixa: os {r.positions.length} instrumentos escolhidos com os sinais de {f.date(r.firstDate)}, comprados na abertura seguinte e mantidos até hoje, sem revisões; o catálogo foi comprado no mesmo dia.</>
                : <>O rendimento é o de quem tivesse seguido todas as revisões, comprando e vendendo na abertura da sessão seguinte a cada uma ({s.reviews} revisões,
                  {' '}{s.tradesPerReview.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} trocas em média).</>}
              {' '}O catálogo é o de hoje: as empresas que saíram da bolsa não entram, o que favorece os dois resultados.
            </p>
          </section>

          {r.start ? (
            <section className="card" aria-labelledby="pr-fixed">
              <h2 id="pr-fixed" className="card-title" style={{ marginBottom: '0.25rem' }}>Carteira escolhida em {f.date(r.firstDate)}</h2>
              <p className="small muted" style={{ marginTop: 0 }}>
                Os {r.positions.length} instrumentos com melhor pontuação das Promessas nesse dia ({r.review.eligible} elegíveis), só com os dados até essa data,
                no máximo {o.maxPerSector} por sector, comprados em partes iguais na abertura seguinte e mantidos até hoje, sem revisões. «Lugar» é o lugar no ranking desse dia.
              </p>
              <PickTable id="pr-fixed-list" title="Carteira" kind="keep" items={r.positions} empty="Nenhum instrumento elegível nesse dia."
                hint={`Peso de hoje e resultado desde a compra, com dividendos e custos.`} logoVersions={logoVersions} pending={pending} onToggle={toggle} />
            </section>
          ) : (
          <section className="card" aria-labelledby="pr-review">
              <h2 id="pr-review" className="card-title" style={{ marginBottom: '0.25rem' }}>
                {state === 'none' ? 'Ainda sem revisões' : `Revisão de ${f.date(r.review.date)}`}
              </h2>
              {state !== 'none' && (
                <p className="small muted" style={{ marginTop: 0 }}>
                  {state === 'pending'
                    ? 'Decidida com o fecho desse dia: as compras e as vendas são para a abertura da sessão seguinte.'
                    : `Decidida com o fecho desse dia e executada na abertura de ${f.date(r.review.executionDate)}.`}
                  {' '}{r.review.eligible} instrumentos elegíveis em {r.universe}. Próxima revisão: primeira sessão a partir de {f.date(r.review.next)}, depois do fecho.
                </p>
              )}
              {state === 'pending' && <Notice tone="info">Revisão nova: as listas abaixo são as ordens a dar na abertura da próxima sessão.</Notice>}
              <div className="grid" style={{ marginTop: '0.75rem' }}>
                <div className="span-12">
                  <PickTable id="pr-buy" title="Comprar" kind="buy" items={r.review.buy} empty="Nada a comprar nesta revisão."
                    hint="Entram na carteira, pela ordem do ranking, em partes iguais do dinheiro disponível." logoVersions={logoVersions} pending={pending} onToggle={toggle} />
                </div>
                <div className="span-12">
                  <PickTable id="pr-keep" title="Manter" kind="keep" items={r.review.keep} empty="Nenhuma posição a manter."
                    hint="Continuam na carteira, sem reequilibrar os pesos." logoVersions={logoVersions} pending={pending} onToggle={toggle} />
                </div>
                <div className="span-12">
                  <PickTable id="pr-sell" title="Vender" kind="sell" items={r.review.sell} empty="Nada a vender nesta revisão."
                    hint="Saem da carteira: deixaram de estar entre os melhores ou perderam a tendência." logoVersions={logoVersions} pending={pending} onToggle={toggle} />
                </div>
              </div>
            </section>
          )}

          <section className="card" aria-labelledby="pr-sectors">
            <h2 id="pr-sectors" className="card-title" style={{ marginBottom: '0.5rem' }}>
              Carteira por sector <span className="muted small">({r.positions.length} posições; {pct1(s.invested * 100)} investido)</span>
            </h2>
            {r.positions.length === 0 ? <p className="small muted">Carteira em numerário: nenhum instrumento cumpre a tendência.</p> : (
              <div className="table-wrap" tabIndex={0} aria-labelledby="pr-sectors">
                <table className="data">
                  <thead><tr><th scope="col">Sector</th><th scope="col" className="r">Posições</th><th scope="col" className="r">Peso</th><th scope="col" style={{ width: '45%' }}><span className="visually-hidden">Peso em barra</span></th></tr></thead>
                  <tbody>
                    {bySector(r.positions).map((x) => (
                      <tr key={x.sector}>
                        <td>{x.sector}</td>
                        <td className="r num">{x.count}</td>
                        <td className="r num">{pct1(x.weight * 100)}</td>
                        <td aria-hidden="true"><div style={{ height: 8, borderRadius: 4, background: 'var(--series-price)', width: `${Math.min(100, x.weight * 100 * 2.5)}%`, minWidth: 2 }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {!r.start && (
            <>
          <section className="card" aria-labelledby="pr-history">
                <h2 id="pr-history" className="card-title" style={{ marginBottom: '0.75rem' }}>Revisões anteriores <span className="muted small">(as {r.reviews.length} mais recentes)</span></h2>
                <div className="table-wrap" tabIndex={0} aria-labelledby="pr-history">
                  <table className="data">
                    <thead><tr><th scope="col">Revisão</th><th scope="col">Entraram</th><th scope="col">Saíram</th><th scope="col" className="r">Mantidas</th></tr></thead>
                    <tbody>
                      {r.reviews.map((x) => (
                        <tr key={x.date}>
                          <td className="small">{f.date(x.date)}</td>
                          <td className="small">{x.bought.length ? x.bought.join(', ') : <span className="muted">—</span>}</td>
                          <td className="small">{x.sold.length ? x.sold.join(', ') : <span className="muted">—</span>}</td>
                          <td className="r num">{x.kept}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card" aria-labelledby="pr-trades">
                <h2 id="pr-trades" className="card-title" style={{ marginBottom: '0.75rem' }}>Posições fechadas <span className="muted small">({s.closed} {r.start ? `desde ${f.date(r.start)}` : `em ${r.windowMonths} meses`}; as 100 mais recentes)</span></h2>
                {r.trades.length === 0 ? <p className="small muted">Ainda sem posições fechadas.</p> : (
                  <div className="table-wrap" tabIndex={0} aria-labelledby="pr-trades" style={{ maxHeight: 420, overflowY: 'auto' }}>
                    <table className="data">
                      <thead><tr><th scope="col">Instrumento</th><th scope="col">Entrada</th><th scope="col">Saída</th><th scope="col">Motivo</th><th scope="col" className="r">Resultado</th></tr></thead>
                      <tbody>
                        {r.trades.map((t, k) => (
                          <tr key={`${t.instrumentId}-${t.buyDate}-${k}`}>
                            <td><Link to={`/charts?instrumento=${t.instrumentId}`} className="row-link">{t.symbol}</Link><div className="small muted">{t.name}</div></td>
                            <td className="small">{f.date(t.buyDate)}</td>
                            <td className="small">{f.date(t.sellDate)}</td>
                            <td className="small" title={REASONS[t.reason].help}>{REASONS[t.reason].label}</td>
                            <td className={`r num ${tone(t.pnlPct)}`}>{signedPct(t.pnlPct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          <Notice tone="info">
            Carteira calculada por uma regra fixa sobre dados passados; os resultados passados não garantem os futuros e isto não é aconselhamento de
            investimento. A regra segue a tendência: no mercado em queda de 2022 perdeu 24,5 %, contra 8,8 % do catálogo, e de mar. 2021 a hoje
            rendeu +119 % contra +130 % do catálogo; a vantagem dos últimos 24 meses depende de o mercado estar a subir. A Automação não usa esta carteira.
          </Notice>
        </>
      )}
    </>
  );
}
