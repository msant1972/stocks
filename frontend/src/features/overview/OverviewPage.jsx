import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { alertCondition } from '../../lib/alerts.js';
import { useAlertEvents, useMe, usePortfolio, useStatus, useWatchlist } from '../../lib/queries.js';
import { getStrategy } from '../../lib/strategy.js';
import Sparkline from '../../components/finance/Sparkline.jsx';
import { PnL, PriceChange, QuoteDate, SimulatedBadge } from '../../components/finance/finance.jsx';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';

const chartLink = (id, strategy) => `/charts?instrumento=${id}${strategy ? `&estrategia=${strategy}` : ''}`;

function PortfolioCard() {
  const { data: p, isPending, error, refetch } = usePortfolio();
  const history = useQuery({ queryKey: ['portfolio', 'history'], queryFn: () => api.get('/portfolio/history'), staleTime: 5 * 60_000 });
  const points = history.data?.points ?? [];
  return (
    <section className="card span-12" aria-labelledby="pf-title">
      <div className="card-head">
        <h2 id="pf-title" className="card-title">Valor da carteira virtual</h2>
        <Link to="/carteira" className="small">Ver carteira</Link>
      </div>
      {isPending ? <Loading rows={2} /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <>
          <div className="spread" style={{ alignItems: 'flex-end' }}>
            <div>
              <p className="hero-value">{f.money(p.totalValue, p.currency)}</p>
              <p className="small muted" style={{ marginTop: 4 }}>
                {p.valuationDate ? `Valorizado ao último preço disponível (${f.date(p.valuationDate)})` : 'Sem posições: valor igual ao saldo disponível'}
              </p>
            </div>
            {points.length > 1 && (
              <div style={{ flex: '1 1 10rem', maxWidth: '14rem' }}>
                <Sparkline values={points.map((x) => x.total)} tone={points.at(-1).total >= history.data.initialCapital ? 'positive' : 'negative'}
                  label={`Evolução do valor da carteira desde ${f.date(points[0].date)}: de ${f.money(points[0].total)} para ${f.money(points.at(-1).total)}`} />
                <p className="small muted">Desde {f.date(points[0].date)}</p>
              </div>
            )}
          </div>
          <div className="stats">
            <div><p className="stat-label">Saldo virtual disponível</p><p className="stat-value">{f.money(p.cashBalance, p.currency)}</p></div>
            <div><p className="stat-label">Montante investido (custo)</p><p className="stat-value">{f.money(p.invested, p.currency)}</p></div>
            <div>
              <p className="stat-label">Resultado acumulado</p>
              <p className="stat-value"><PnL value={p.totalPnl} currency={p.currency} /></p>
              <p className="small muted">Face ao capital inicial de {f.money(p.initialCapital, p.currency)}</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

const ZONES = [
  { key: 'above', label: 'Acima de +1%', color: 'var(--heat-up)' },
  { key: 'neutral', label: 'Entre −1% e +1%', color: 'var(--heat-flat)' },
  { key: 'below', label: 'Abaixo de −1%', color: 'var(--heat-down)' },
];

const SIDE = { buy: { label: 'Compra', letter: 'C', tone: 'positive' }, add: { label: 'Reforço', letter: 'R', tone: '' }, sell: { label: 'Venda', letter: 'V', tone: 'negative' } };
const SHOWN = 6;

/** Sinais de compra, reforço e venda das estratégias, na última sessão, nos instrumentos da minha lista. */
function SignalsTodayCard() {
  const q = useQuery({ queryKey: ['signals', 'watchlist', 1], queryFn: () => api.get('/signals/watchlist?sessions=1'), staleTime: 5 * 60_000 });
  const items = q.data?.items ?? [];
  return (
    <section className="card span-6" aria-labelledby="sg-title">
      <div className="card-head">
        <div>
          <h2 id="sg-title" className="card-title">Sinais da última sessão</h2>
          <p className="small muted">Nos instrumentos da minha lista{q.data?.latestSession ? ` (${f.date(q.data.latestSession)})` : ''}. Simulação.</p>
        </div>
        <Link to="/sinais" className="small">Ver sinais</Link>
      </div>
      {q.isPending ? <Loading rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : items.length === 0 ? (
        <p className="small muted">Nenhuma estratégia deu sinais nos instrumentos da sua lista na última sessão.</p>
      ) : (
        <ul className="list">
          {items.slice(0, SHOWN).map((s) => {
            const side = SIDE[s.side];
            return (
              <li key={`${s.instrumentId}-${s.strategy}-${s.side}`} className="list-item" style={{ padding: '0.5rem 0' }}>
                <div style={{ minWidth: 0 }}>
                  <Link to={chartLink(s.instrumentId, s.strategy)} className="row-link">{s.symbol}</Link>
                  <div className="small muted">{getStrategy(s.strategy)?.name ?? s.strategy}</div>
                </div>
                <span className={`num ${side.tone}`} style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{side.letter} · {side.label}</span>
              </li>
            );
          })}
          {items.length > SHOWN && <li className="small muted" style={{ paddingTop: '0.5rem' }}>e mais {items.length - SHOWN} em Sinais.</li>}
        </ul>
      )}
    </section>
  );
}

/** Alertas disparados mais recentes. */
function RecentAlertsCard() {
  const events = useAlertEvents();
  const items = (events.data?.items ?? []).slice(0, 5);
  return (
    <section className="card span-6" aria-labelledby="al-title">
      <div className="card-head">
        <h2 id="al-title" className="card-title">Alertas recentes</h2>
        <Link to="/alertas" className="small">Ver alertas</Link>
      </div>
      {events.isPending ? <Loading rows={3} /> : events.error ? <ErrorState error={events.error} onRetry={events.refetch} /> : items.length === 0 ? (
        <p className="small muted">Ainda não disparou nenhum alerta. <Link to="/alertas">Criar um alerta</Link></p>
      ) : (
        <ul className="list">
          {items.map((e) => (
            <li key={e.id} className="list-item" style={{ padding: '0.5rem 0' }}>
              <div style={{ minWidth: 0 }}>
                <Link to={chartLink(e.instrumentId)} className="row-link">{e.symbol}</Link>
                <div className="small muted">{alertCondition({ ...e, currency: 'EUR' })}</div>
              </div>
              <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{f.shortDate(e.sessionDate)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MoverList({ title, items }) {
  return (
    <div style={{ minWidth: 0 }}>
      <h3 className="stat-label" style={{ fontWeight: 500, marginBottom: 4 }}>{title}</h3>
      {items.length === 0 ? <p className="small muted">Nenhum.</p> : (
        <ol className="list">
          {items.map((i) => (
            <li key={i.id} className="list-item" style={{ padding: '0.5rem 0' }}>
              <div style={{ minWidth: 0 }}>
                <Link to={chartLink(i.id)} className="row-link">{i.symbol}</Link>
                <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</div>
              </div>
              <PriceChange value={i.latest.changePct} showLabel={false} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Maiores subidas e descidas da última sessão nos instrumentos da minha lista. */
function MoversCard() {
  const wl = useWatchlist();
  const withChange = (wl.data?.items ?? []).filter((i) => i.latest?.changePct != null);
  const up = withChange.filter((i) => Number(i.latest.changePct) > 0).sort((a, b) => Number(b.latest.changePct) - Number(a.latest.changePct)).slice(0, 3);
  const down = withChange.filter((i) => Number(i.latest.changePct) < 0).sort((a, b) => Number(a.latest.changePct) - Number(b.latest.changePct)).slice(0, 3);
  return (
    <section className="card span-12" aria-labelledby="mv-title">
      <div className="card-head">
        <h2 id="mv-title" className="card-title">Subidas e descidas da minha lista</h2>
        <Link to="/charts" className="small">Ver gráficos</Link>
      </div>
      {wl.isPending ? <Loading rows={3} /> : wl.error ? <ErrorState error={wl.error} onRetry={wl.refetch} /> : withChange.length === 0 ? (
        <EmptyState title="A sua lista está vazia" action={<Link className="button" to="/acompanhar">Acompanhar instrumentos</Link>}>
          Adicione instrumentos para ver aqui as maiores subidas e descidas do dia.
        </EmptyState>
      ) : (
        <div className="grid" style={{ gap: '1.5rem' }}>
          <div className="span-6"><MoverList title="Maiores subidas" items={up} /></div>
          <div className="span-6"><MoverList title="Maiores descidas" items={down} /></div>
        </div>
      )}
    </section>
  );
}

function MomentumList({ title, items }) {
  return (
    <div style={{ minWidth: 0 }}>
      <h3 className="stat-label" style={{ fontWeight: 500, marginBottom: 4 }}>{title}</h3>
      <ol className="list">
        {items.map((e) => (
          <li key={e.instrumentId} className="list-item" style={{ padding: '0.5rem 0' }}>
            <div style={{ minWidth: 0 }}>
              <Link to={chartLink(e.instrumentId)} className="row-link">{e.symbol}</Link>
              <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
            </div>
            <PriceChange value={e.momentumPct} showLabel={false} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Momento do catálogo: SMA10/SMA200 na última sessão — distribuição e extremos. */
function MarketMomentumCard() {
  const q = useQuery({ queryKey: ['market-momentum'], queryFn: () => api.get('/market/momentum?top=5'), staleTime: 5 * 60_000 });
  const m = q.data;
  return (
    <section className="card span-12" aria-labelledby="mm-title">
      <div className="card-head">
        <div>
          <h2 id="mm-title" className="card-title">Momento do mercado</h2>
          <p className="small muted">
            SMA10/SMA200 na última sessão{m?.latestSession ? ` (${f.date(m.latestSession)})` : ''}
            {m ? `, ${m.total} instrumentos com SMA200` : ''}.
          </p>
        </div>
        <Link to="/heatmap" className="small">Ver HeatMap</Link>
      </div>
      {q.isPending ? <Loading rows={4} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : m.total === 0 ? (
        <EmptyState title="Sem dados de momento">Os instrumentos ainda não têm 200 sessões para calcular a SMA200.</EmptyState>
      ) : (
        <div className="stack" style={{ gap: '1.25rem' }}>
          <div>
            <div className="momentum-bar" role="img"
              aria-label={`${m.above} instrumentos acima de +1%, ${m.neutral} entre −1% e +1%, ${m.below} abaixo de −1%`}>
              {ZONES.map((z) => m[z.key] > 0 && (
                <span key={z.key} style={{ flexGrow: m[z.key], background: z.color }} title={`${z.label}: ${m[z.key]}`} />
              ))}
            </div>
            <div className="legend-chips" style={{ marginTop: 8 }}>
              {ZONES.map((z) => (
                <span key={z.key} className="legend-chip static">
                  <span className="swatch" style={{ background: z.color, width: 12, height: 12, borderRadius: 3 }} />
                  <strong className="num" style={{ color: 'var(--text)' }}>{m[z.key]}</strong> {z.label.toLowerCase()}
                </span>
              ))}
            </div>
          </div>
          <div className="grid" style={{ gap: '1.5rem' }}>
            <div className="span-6"><MomentumList title="Mais fortes" items={m.strongest} /></div>
            <div className="span-6"><MomentumList title="Mais fracos" items={m.weakest} /></div>
          </div>
        </div>
      )}
    </section>
  );
}

function CrossTable({ title, tone, items, empty }) {
  return (
    <div style={{ minWidth: 0 }}>
      <h3 className="stat-label" style={{ fontWeight: 500, marginBottom: 6 }}>
        <span className={tone}>{tone === 'positive' ? '▲' : '▼'}</span> {title} <span className="num" style={{ color: 'var(--text)' }}>({items.length})</span>
      </h3>
      {items.length === 0 ? <p className="small muted">{empty}</p> : (
        <div className="table-wrap" tabIndex={0} style={{ maxHeight: 360, overflowY: 'auto' }} aria-label={title}>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Instrumento</th>
                <th scope="col">Cruzamento</th>
                <th scope="col" className="r">SMA10/SMA50</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.instrumentId}>
                  <td>
                    <Link to={chartLink(e.instrumentId)} className="row-link">{e.symbol}</Link>
                    <div className="small muted cx-name">{e.name}</div>
                  </td>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>
                    {f.shortDate(e.crossDate)}
                    <div className="muted">{e.sessionsAgo === 0 ? 'última sessão' : `há ${e.sessionsAgo} ${e.sessionsAgo === 1 ? 'sessão' : 'sessões'}`}</div>
                  </td>
                  <td className="r"><PriceChange value={e.gapPct} showLabel={false} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Instrumentos cuja SMA10 cruzou a SMA50 nas últimas 5 sessões, nos dois sentidos. */
function CrossoversCard() {
  const q = useQuery({ queryKey: ['market-crossovers', 5], queryFn: () => api.get('/market/crossovers?sessions=5'), staleTime: 5 * 60_000 });
  const c = q.data;
  return (
    <section className="card span-12" aria-labelledby="cx-title">
      <div className="card-head">
        <div>
          <h2 id="cx-title" className="card-title">Cruzamentos SMA10 / SMA50</h2>
          <p className="small muted">
            Instrumentos cuja SMA10 cruzou a SMA50 nas últimas 5 sessões{c?.latestSession ? ` (até ${f.date(c.latestSession)})` : ''}.
            A coluna SMA10/SMA50 mostra a distância actual entre as médias.
          </p>
        </div>
      </div>
      {q.isPending ? <Loading rows={4} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <div className="grid" style={{ gap: '1.5rem' }}>
          <div className="span-6">
            <CrossTable title="Ascendentes — SMA10 passou acima da SMA50" tone="positive" items={c.up} empty="Nenhum cruzamento ascendente no período." />
          </div>
          <div className="span-6">
            <CrossTable title="Descendentes — SMA10 passou abaixo da SMA50" tone="negative" items={c.down} empty="Nenhum cruzamento descendente no período." />
          </div>
        </div>
      )}
    </section>
  );
}

export default function OverviewPage() {
  const { data } = useMe();
  const latest = useStatus().data?.latestSession;
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Olá, {data?.user.name}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            <SimulatedBadge />
            {latest && <QuoteDate date={latest} prefix="Cotações diárias até" />}
          </div>
        </div>
      </div>
      <div className="grid">
        <PortfolioCard />
        <SignalsTodayCard />
        <RecentAlertsCard />
        <MoversCard />
        <MarketMomentumCard />
        <CrossoversCard />
      </div>
    </>
  );
}
