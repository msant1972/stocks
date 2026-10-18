import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { useMe, usePortfolio, useStatus } from '../../lib/queries.js';
import { PnL, PriceChange, QuoteDate, SimulatedBadge } from '../../components/finance/finance.jsx';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';

function PortfolioCard() {
  const { data: p, isPending, error, refetch } = usePortfolio();
  return (
    <section className="card span-12" aria-labelledby="pf-title">
      <div className="card-head">
        <h2 id="pf-title" className="card-title">Valor da carteira virtual</h2>
        <Link to="/carteira" className="small">Ver carteira</Link>
      </div>
      {isPending ? <Loading rows={2} /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <>
          <p className="hero-value">{f.money(p.totalValue, p.currency)}</p>
          <p className="small muted" style={{ marginTop: 4 }}>
            {p.valuationDate ? `Valorizado ao último fecho disponível (${f.date(p.valuationDate)})` : 'Sem posições: valor igual ao saldo disponível'}
          </p>
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

function MomentumList({ title, items }) {
  return (
    <div style={{ minWidth: 0 }}>
      <h3 className="stat-label" style={{ fontWeight: 500, marginBottom: 4 }}>{title}</h3>
      <ol className="list">
        {items.map((e) => (
          <li key={e.instrumentId} className="list-item" style={{ padding: '0.5rem 0' }}>
            <div style={{ minWidth: 0 }}>
              <Link to={`/instrumentos/${e.instrumentId}`} className="row-link">{e.symbol}</Link>
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
        <MarketMomentumCard />
      </div>
    </>
  );
}
