import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { ORDER_STATUS, ORDER_STATUS_HELP, orderLabel } from '../../lib/saxo.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Button, Notice } from '../../components/ui/controls.jsx';
import { SIM_BANNER, useSaxoStatus } from './SaxoOrderDialog.jsx';
import SaxoModifyDialog from './SaxoModifyDialog.jsx';

const PAGE = 25;
const TONE = { working: 'badge-accent', filled: 'badge-positive', rejected: 'badge-negative', unknown: 'badge-warning' };

export default function SaxoOrdersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null);
  const token = useSaxoStatus();
  const orders = useQuery({
    queryKey: ['saxo-orders', page], queryFn: () => api.get(`/saxo/orders?limit=${PAGE}&offset=${page * PAGE}`),
    // Enquanto houver ordens abertas, volta a confrontar com a SAXO a cada 30 s.
    refetchInterval: (q) => (q.state.data?.items.some((o) => o.status === 'working') ? 30_000 : false),
  });
  const conn = useQuery({ queryKey: ['saxo-connection'], queryFn: () => api.get('/saxo/connection'), enabled: Boolean(token.data?.configured && !token.data?.expired), retry: false, staleTime: 60_000 });
  const cancel = useMutation({
    mutationFn: (id) => api.del(`/saxo/orders/${id}`),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['saxo-orders'] }); qc.invalidateQueries({ queryKey: ['saxo-connection'] }); },
  });
  const total = orders.data?.total ?? 0;
  const s = token.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Ordens SAXO</h1>
          <p className="page-sub">Ordens enviadas por esta aplicação para a conta de simulação da SAXO Bank, com o estado actualizado.</p>
        </div>
      </div>
      <Notice tone="warning">{SIM_BANNER}</Notice>

      {s && !s.configured && <Notice tone="info">Ainda não está ligado à SAXO Bank. <Link to="/definicoes">Ligar em Definições</Link></Notice>}
      {s?.expired && <Notice tone="warning">A ligação à SAXO Bank expirou ou foi recusada. <Link to="/definicoes">Volte a ligar em Definições</Link></Notice>}
      {conn.data && (
        <section className="card" aria-label="Conta SAXO">
          <dl className="summary-box">
            <dt>Conta</dt><dd>{conn.data.accountId}{conn.data.isTrial ? ' · simulação' : ''}</dd>
            <dt>Saldo</dt><dd>{conn.data.cashBalance == null ? '—' : f.money(conn.data.cashBalance, conn.data.currency)}</dd>
            <dt>Valor total</dt><dd>{conn.data.totalValue == null ? '—' : f.money(conn.data.totalValue, conn.data.currency)}</dd>
          </dl>
        </section>
      )}

      <section className="card" aria-labelledby="saxo-orders-title">
        <h2 id="saxo-orders-title" className="visually-hidden">Ordens</h2>
        {orders.data?.refreshError && <Notice tone="warning">Não foi possível actualizar o estado na SAXO: {orders.data.refreshError}</Notice>}
        {cancel.error && <Notice tone="error">{errorMessage(cancel.error)}</Notice>}
        {orders.isPending ? <Loading rows={4} /> : orders.error ? <ErrorState error={orders.error} onRetry={orders.refetch} /> :
          orders.data.items.length === 0 ? (
            <EmptyState title="Sem ordens" action={<Link className="button" to="/charts">Ir para os Charts</Link>}>
              Ainda não enviou nenhuma ordem para a SAXO. Use «Enviar à SAXO» nos Charts, nos Sinais ou na Carteira SAXO.
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap" tabIndex={0} aria-label="Tabela de ordens SAXO">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Enviada</th><th scope="col">Instrumento</th><th scope="col">Ordem</th>
                      <th scope="col" className="r">Quantidade</th><th scope="col" className="r">Preço</th>
                      <th scope="col">Estado</th><th scope="col" className="r"><span className="visually-hidden">Acções</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.data.items.map((o) => (
                      <tr key={o.id}>
                        <td className="small" style={{ whiteSpace: 'nowrap' }}>{f.dateTime(o.createdAt)}<div className="muted">{o.saxoOrderId ? `SAXO ${o.saxoOrderId}` : `#${o.id}`}</div></td>
                        <td><Link to={`/instrumentos/${o.instrumentId}`} className="row-link">{o.symbol}</Link></td>
                        <td>
                          <span className={`badge ${o.side === 'buy' ? 'badge-accent' : ''}`}>{orderLabel(o)}</span>
                          {o.parentId && <div className="small muted">associado à compra #{o.parentId}</div>}
                        </td>
                        <td className="r">{f.quantity(o.quantity)}</td>
                        <td className="r">
                          {o.limitPrice ? f.price(o.limitPrice) : o.stopPrice ? f.price(o.stopPrice) : <span className="muted">mercado</span>}
                          {o.trailDistance && <div className="small muted">distância {f.price(o.trailDistance)}</div>}
                        </td>
                        <td>
                          <span className={`badge ${TONE[o.status] ?? ''}`}>{ORDER_STATUS[o.status]}</span>
                          {o.status === 'filled' && o.filledQuantity != null && (
                            <div className="small">{f.quantity(o.filledQuantity)} a {f.price(o.fillPrice)}{o.finishedAt ? ` · ${f.dateTime(o.finishedAt)}` : ''}</div>
                          )}
                          {o.status !== 'filled' && o.finishedAt && <div className="small muted">{f.dateTime(o.finishedAt)}</div>}
                          {(o.message || ORDER_STATUS_HELP[o.status]) && <div className="small muted">{o.message ?? ORDER_STATUS_HELP[o.status]}</div>}
                        </td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }}>
                          {o.status === 'working' && ['limit', 'stop'].includes(o.orderType) && o.saxoOrderId && (
                            <><Button size="small" onClick={() => setEditing(o)}>Alterar<span className="visually-hidden"> ordem {o.symbol}</span></Button>{' '}</>
                          )}
                          {o.status === 'working' && o.saxoOrderId && (
                            <Button size="small" onClick={() => cancel.mutate(o.id)} busy={cancel.isPending && cancel.variables === o.id}>
                              Cancelar<span className="visually-hidden"> ordem {o.symbol}</span>
                            </Button>
                          )}
                        </td>
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
      <SaxoModifyDialog order={editing} onClose={() => setEditing(null)} />
    </>
  );
}
