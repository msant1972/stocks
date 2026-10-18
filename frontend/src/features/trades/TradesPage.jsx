import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import * as f from '../../lib/format.js';
import { usePortfolio, useTrades } from '../../lib/queries.js';
import { PnL } from '../../components/finance/finance.jsx';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Button, Field } from '../../components/ui/controls.jsx';

const PAGE = 25;

export default function TradesPage() {
  // Filtros guardados no URL, para se manterem ao voltar à página.
  const [params, setParams] = useSearchParams();
  const filters = {
    instrumentId: params.get('instrumento') ?? '', side: params.get('tipo') ?? '',
    from: params.get('de') ?? '', to: params.get('ate') ?? '',
  };
  const [page, setPage] = useState(0);
  const trades = useTrades({ ...filters, limit: PAGE, offset: page * PAGE });
  const portfolio = usePortfolio();

  const setFilter = (name, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value); else next.delete(name);
    setParams(next, { replace: true });
    setPage(0);
  };

  const instruments = portfolio.data?.positions ?? [];
  const total = trades.data?.total ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Operações</h1>
          <p className="page-sub">Histórico das compras e vendas simuladas, com o preço e a data da cotação efectivamente usados.</p>
        </div>
      </div>

      <section className="card" aria-labelledby="filters-title">
        <h2 id="filters-title" className="visually-hidden">Filtros</h2>
        <div className="filters">
          <div>
            <Field label="Tipo">
              {(p) => (
                <select {...p} className="select" value={filters.side} onChange={(e) => setFilter('tipo', e.target.value)}>
                  <option value="">Todas</option><option value="buy">Compras</option><option value="sell">Vendas</option>
                </select>
              )}
            </Field>
          </div>
          <div>
            <Field label="Instrumento" help={instruments.length ? null : 'Lista com os instrumentos em carteira'}>
              {(p) => (
                <select {...p} className="select" value={filters.instrumentId} onChange={(e) => setFilter('instrumento', e.target.value)}>
                  <option value="">Todos</option>
                  {instruments.map((i) => <option key={i.instrumentId} value={i.instrumentId}>{i.symbol}</option>)}
                </select>
              )}
            </Field>
          </div>
          <div>
            <Field label="Desde">{(p) => <input {...p} type="date" className="input" value={filters.from} onChange={(e) => setFilter('de', e.target.value)} />}</Field>
          </div>
          <div>
            <Field label="Até">{(p) => <input {...p} type="date" className="input" value={filters.to} onChange={(e) => setFilter('ate', e.target.value)} />}</Field>
          </div>
        </div>

        {trades.isPending ? <Loading rows={5} /> : trades.error ? <ErrorState error={trades.error} onRetry={trades.refetch} /> :
          trades.data.items.length === 0 ? (
            <EmptyState title="Sem operações" action={<Link className="button" to="/carteira">Ir para a carteira</Link>}>
              {Object.values(filters).some(Boolean) ? 'Nenhuma operação corresponde aos filtros.' : 'Ainda não fez nenhuma operação simulada.'}
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap" tabIndex={0} aria-label="Tabela de operações">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Pedido</th>
                      <th scope="col">Operação</th>
                      <th scope="col">Instrumento</th>
                      <th scope="col" className="r">Quantidade</th>
                      <th scope="col" className="r">Preço aplicado</th>
                      <th scope="col">Data da cotação</th>
                      <th scope="col" className="r">Total</th>
                      <th scope="col" className="r">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.data.items.map((t) => (
                      <tr key={t.id}>
                        <td className="small" style={{ whiteSpace: 'nowrap' }}>{f.dateTime(t.requestedAt)}<div className="muted">#{t.id}</div></td>
                        <td><span className={`badge ${t.side === 'buy' ? 'badge-accent' : ''}`}>{t.side === 'buy' ? 'Compra simulada' : 'Venda simulada'}</span></td>
                        <td><Link to={`/instrumentos/${t.instrumentId}`} className="row-link">{t.symbol}</Link></td>
                        <td className="r">{f.quantity(t.quantity)}</td>
                        <td className="r">{f.price(t.price, t.currency)}</td>
                        <td className="small" style={{ whiteSpace: 'nowrap' }}>{f.date(t.quoteDate)}</td>
                        <td className="r">{f.money(t.amount, t.currency)}</td>
                        <td className="r">{t.realizedPnl != null ? <PnL value={t.realizedPnl} currency={t.currency} /> : <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {total > PAGE && (
                <div className="spread" style={{ marginTop: '1rem' }}>
                  <span className="small muted">{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} de {total}</span>
                  <div className="row">
                    <Button size="small" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>Anteriores</Button>
                    <Button size="small" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((x) => x + 1)}>Seguintes</Button>
                  </div>
                </div>
              )}
            </>
          )}
      </section>
    </>
  );
}
