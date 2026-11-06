import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { PnL } from '../../components/finance/finance.jsx';
import { Button, Notice } from '../../components/ui/controls.jsx';
import SaxoOrderDialog, { SIM_BANNER, useSaxoStatus } from './SaxoOrderDialog.jsx';

const AccountHistoryChart = lazy(() => import('../../components/finance/AccountHistoryChart.jsx'));

const muted = <span className="muted">—</span>;

export default function SaxoPortfolioPage() {
  const token = useSaxoStatus();
  const ready = Boolean(token.data?.configured && !token.data?.expired);
  const q = useQuery({ queryKey: ['saxo-portfolio'], queryFn: () => api.get('/saxo/portfolio'), enabled: ready, retry: false, refetchOnWindowFocus: false });
  const history = useQuery({ queryKey: ['saxo-portfolio', 'history'], queryFn: () => api.get('/saxo/portfolio/history'), staleTime: 5 * 60_000 });
  const [selling, setSelling] = useState(null); // { instrument, quantity }
  const d = q.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Carteira SAXO</h1>
          <p className="page-sub">A carteira da aplicação: saldo, evolução do valor e posições da conta de simulação da SAXO Bank.</p>
        </div>
        {ready && <Button onClick={() => q.refetch()} busy={q.isFetching}>Actualizar</Button>}
      </div>
      <Notice tone="warning">{SIM_BANNER}</Notice>
      {token.data && !token.data.configured && <Notice tone="info">Ainda não está ligado à SAXO Bank. <Link to="/definicoes">Ligar em Definições</Link></Notice>}
      {token.data?.expired && <Notice tone="warning">A ligação à SAXO Bank expirou ou foi recusada. <Link to="/definicoes">Volte a ligar em Definições</Link></Notice>}

      {ready && (q.isPending ? <Loading rows={4} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <section className="card" aria-label="Conta SAXO">
            <dl className="summary-box">
              <dt>Conta</dt><dd>{d.accountId}{d.isTrial ? ' · simulação' : ''}</dd>
              <dt>Saldo</dt><dd>{d.cashBalance == null ? '—' : f.money(d.cashBalance, d.currency)}</dd>
              <dt>Valor total da conta</dt><dd>{d.totalValue == null ? '—' : f.money(d.totalValue, d.currency)}</dd>
              <dt>Montante investido (custo)</dt><dd>{f.money(d.invested, d.currency)}</dd>
            </dl>
          </section>

          <section className="card" aria-labelledby="saxo-history-title">
            <h2 id="saxo-history-title" className="card-title">Evolução da carteira</h2>
            {history.isPending ? <Loading rows={3} /> : history.error ? <ErrorState error={history.error} onRetry={history.refetch} />
              : history.data.points.length < 2 ? (
                <p className="small muted">O valor da conta é guardado no fim de cada sessão; o gráfico aparece a partir da segunda leitura.</p>
              ) : (
                <Suspense fallback={<Loading rows={3} label="A carregar o gráfico…" />}>
                  <AccountHistoryChart history={history.data} />
                </Suspense>
              )}
          </section>

          <section className="card" aria-labelledby="saxo-pos-title">
            <h2 id="saxo-pos-title" className="card-title">Posições abertas</h2>
            <p className="small muted" style={{ margin: '0.25rem 0 1rem' }}>
              A conta de simulação não tem preços de mercado: o valor e o resultado usam o último preço da aplicação.
            </p>
            {d.positions.length === 0 ? (
              <EmptyState title="Sem posições" action={<Link className="button" to="/saxo/ordens">Ver ordens SAXO</Link>}>
                A conta de simulação não tem posições abertas. Uma ordem só cria posição depois de executada.
              </EmptyState>
            ) : (
              <div className="table-wrap" tabIndex={0} aria-label="Tabela de posições SAXO">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Instrumento</th><th scope="col" className="r">Quantidade</th><th scope="col" className="r">Preço de abertura</th>
                      <th scope="col" className="r">Último preço</th><th scope="col" className="r">Valor</th><th scope="col" className="r">Resultado</th>
                      <th scope="col"><span className="visually-hidden">Acções</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.positions.map((p) => (
                      <tr key={p.positionId}>
                        <td>{p.instrumentId ? <Link to={`/instrumentos/${p.instrumentId}`} className="row-link">{p.symbol}</Link> : p.symbol}
                          {p.name && <div className="small muted">{p.name}</div>}</td>
                        <td className="r">{f.quantity(p.quantity)}</td>
                        <td className="r">{f.price(p.openPrice, p.currency)}</td>
                        <td className="r">{p.price == null ? muted : f.price(p.price, p.currency)}</td>
                        <td className="r">{p.marketValue == null ? muted : f.money(p.marketValue, p.currency)}</td>
                        <td className="r">{p.pnl == null ? muted : <PnL value={p.pnl} currency={p.currency} />}</td>
                        <td className="r">
                          <Button size="small" disabled={!p.instrumentId}
                            title={p.instrumentId ? `Vender ${f.quantity(p.quantity)} unidades na SAXO` : 'Instrumento sem correspondência na aplicação: venda na plataforma da SAXO'}
                            onClick={() => setSelling({
                              instrument: { id: p.instrumentId, symbol: p.symbol, name: p.name, currency: p.currency, latest: { close: p.price } },
                              quantity: p.quantity,
                            })}>
                            Vender<span className="visually-hidden"> {p.symbol}</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="saxo-closed-title">
            <h2 id="saxo-closed-title" className="card-title">Posições fechadas</h2>
            {d.closed.length === 0 ? (
              <p className="small muted">Ainda não há posições fechadas na conta de simulação.</p>
            ) : (
              <div className="table-wrap" tabIndex={0} aria-label="Tabela de posições SAXO fechadas">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Fechada</th><th scope="col">Instrumento</th><th scope="col" className="r">Quantidade</th>
                      <th scope="col" className="r">Abertura</th><th scope="col" className="r">Fecho</th><th scope="col" className="r">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.closed.map((c) => (
                      <tr key={c.closedPositionId}>
                        <td className="small" style={{ whiteSpace: 'nowrap' }}>{c.closedAt ? f.dateTime(c.closedAt) : '—'}</td>
                        <td>{c.instrumentId ? <Link to={`/instrumentos/${c.instrumentId}`} className="row-link">{c.symbol}</Link> : c.symbol}</td>
                        <td className="r">{f.quantity(c.quantity)}</td>
                        <td className="r">{c.openPrice == null ? muted : f.price(c.openPrice, c.currency)}</td>
                        <td className="r">{c.closePrice == null ? muted : f.price(c.closePrice, c.currency)}</td>
                        <td className="r">{c.pnl == null ? muted : <PnL value={c.pnl} currency={c.currency} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ))}
      <SaxoOrderDialog open={Boolean(selling)} onClose={() => { setSelling(null); q.refetch(); }} instrument={selling?.instrument} initialSide="sell" initialQuantity={selling?.quantity} />
    </>
  );
}
