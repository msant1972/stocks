import { Link } from 'react-router';
import * as f from '../../lib/format.js';
import { useAlerts, useMe, usePortfolio, useTrades, useWatchlist } from '../../lib/queries.js';
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

function WatchlistCard() {
  const { data, isPending, error, refetch } = useWatchlist();
  return (
    <section className="card span-8" aria-labelledby="wl-title">
      <div className="card-head">
        <h2 id="wl-title" className="card-title">Instrumentos acompanhados</h2>
        <Link to="/acompanhar" className="small">Gerir lista</Link>
      </div>
      {isPending ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : data.items.length === 0 ? (
        <EmptyState title="Ainda não acompanha nenhum instrumento" action={<Link className="button" to="/acompanhar">Adicionar instrumentos</Link>}>
          Adicione símbolos ao catálogo, à mão ou por importação de Excel.
        </EmptyState>
      ) : (
        <ul className="list">
          {data.items.slice(0, 8).map((i) => (
            <li key={i.id} className="list-item">
              <div style={{ minWidth: 0 }}>
                <Link to={`/instrumentos/${i.id}`} className="row-link">{i.symbol}</Link>
                <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name ?? 'A validar no fornecedor'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ fontWeight: 500 }}>{i.latest ? f.price(i.latest.close, i.currency) : '—'}</div>
                {i.latest ? <PriceChange value={i.latest.changePct} showLabel={false} /> : <span className="small muted">Sem dados</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityCard() {
  const trades = useTrades({ limit: 5 });
  const alerts = useAlerts();
  const active = alerts.data?.items.filter((a) => a.active).length ?? 0;
  return (
    <section className="card span-4" aria-labelledby="act-title">
      <h2 id="act-title" className="card-title" style={{ marginBottom: '1rem' }}>Actividade</h2>
      <p className="stat-label">Operações recentes</p>
      {trades.isPending ? <Loading rows={2} /> : trades.data?.items.length ? (
        <ul className="list">
          {trades.data.items.map((t) => (
            <li key={t.id} className="list-item small">
              <span><strong>{t.symbol}</strong> · {t.side === 'buy' ? 'Compra simulada' : 'Venda simulada'}</span>
              <span className="num">{f.quantity(t.quantity)} un.</span>
            </li>
          ))}
        </ul>
      ) : <p className="small muted" style={{ margin: '0.5rem 0 1rem' }}>Ainda não há operações simuladas.</p>}
      <div className="spread" style={{ marginTop: '1rem' }}>
        <span className="stat-label">Alertas activos</span>
        <Link to="/alertas" className="num" style={{ fontWeight: 600 }}>{alerts.isPending ? '…' : active}</Link>
      </div>
    </section>
  );
}

export default function OverviewPage() {
  const { data } = useMe();
  const wl = useWatchlist();
  const latest = wl.data?.items.map((i) => i.latest?.date).filter(Boolean).sort().at(-1);
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
        <WatchlistCard />
        <ActivityCard />
      </div>
    </>
  );
}
