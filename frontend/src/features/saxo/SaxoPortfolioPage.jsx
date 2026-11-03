import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { PnL } from '../../components/finance/finance.jsx';
import { Notice } from '../../components/ui/controls.jsx';
import { SIM_BANNER, useSaxoStatus } from './SaxoOrderDialog.jsx';

export default function SaxoPortfolioPage() {
  const token = useSaxoStatus();
  const ready = Boolean(token.data?.configured && !token.data?.expired);
  const q = useQuery({ queryKey: ['saxo-portfolio'], queryFn: () => api.get('/saxo/portfolio'), enabled: ready, retry: false, refetchOnWindowFocus: false });
  const d = q.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Carteira SAXO</h1>
          <p className="page-sub">Saldo e posições da conta de simulação da SAXO Bank. É à parte da carteira virtual da aplicação.</p>
        </div>
      </div>
      <Notice tone="warning">{SIM_BANNER}</Notice>
      {token.data && !token.data.configured && <Notice tone="info">Ainda não guardou o token da SAXO Bank. <Link to="/definicoes">Abrir Definições</Link></Notice>}
      {token.data?.expired && <Notice tone="warning">O token da SAXO Bank expirou ou foi recusado. <Link to="/definicoes">Guarde um novo em Definições</Link></Notice>}

      {ready && (q.isPending ? <Loading rows={4} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <section className="card" aria-label="Conta SAXO">
            <dl className="summary-box">
              <dt>Conta</dt><dd>{d.accountId}{d.isTrial ? ' · simulação' : ''}</dd>
              <dt>Saldo</dt><dd>{d.cashBalance == null ? '—' : f.money(d.cashBalance, d.currency)}</dd>
              <dt>Valor total da conta</dt><dd>{d.totalValue == null ? '—' : f.money(d.totalValue, d.currency)}</dd>
            </dl>
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
                    </tr>
                  </thead>
                  <tbody>
                    {d.positions.map((p) => (
                      <tr key={p.positionId}>
                        <td>{p.instrumentId ? <Link to={`/instrumentos/${p.instrumentId}`} className="row-link">{p.symbol}</Link> : p.symbol}
                          {p.name && <div className="small muted">{p.name}</div>}</td>
                        <td className="r">{f.quantity(p.quantity)}</td>
                        <td className="r">{f.price(p.openPrice, p.currency)}</td>
                        <td className="r">{p.price == null ? <span className="muted">—</span> : f.price(p.price, p.currency)}</td>
                        <td className="r">{p.marketValue == null ? <span className="muted">—</span> : f.money(p.marketValue, p.currency)}</td>
                        <td className="r">{p.pnl == null ? <span className="muted">—</span> : <PnL value={p.pnl} currency={p.currency} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ))}
    </>
  );
}
