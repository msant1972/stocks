import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { NOTICE_KIND, orderLabel } from '../../lib/saxo.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Button, Notice, Switch } from '../../components/ui/controls.jsx';

export default function SaxoAlertsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['saxo-alerts'], queryFn: () => api.get('/saxo/alerts') });
  const setEmail = useMutation({
    mutationFn: (emailEnabled) => api.put('/saxo/alerts/settings', { emailEnabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saxo-alerts'] }),
  });
  const markRead = useMutation({
    mutationFn: () => api.post('/saxo/alerts/read'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saxo-alerts'] }),
  });
  const d = q.data;
  const unread = d?.items.filter((i) => !i.read).length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Alertas SAXO</h1>
          <p className="page-sub">Avisos de ordens enviadas à SAXO Bank que terminaram: executadas (com quantidade e preço), expiradas ou canceladas fora da aplicação.</p>
        </div>
        {unread > 0 && <Button onClick={() => markRead.mutate()} busy={markRead.isPending}>Marcar como lidos</Button>}
      </div>

      {q.isPending ? <Loading rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <section className="card" aria-labelledby="saxo-alert-pref">
            <h2 id="saxo-alert-pref" className="card-title">Email</h2>
            <p className="small muted" style={{ margin: '0.25rem 0 1rem' }}>
              A aplicação acompanha as suas ordens abertas na SAXO em tempo real (e confirma a cada minuto) e envia-lhe um email quando alguma termina.
              Confirme sempre o resultado na plataforma da SAXO.
            </p>
            <div className="row">
              <Switch checked={d.emailEnabled} onChange={(v) => setEmail.mutate(v)} disabled={setEmail.isPending} label="Receber email quando uma ordem SAXO termina" />
              <span aria-hidden="true">Receber email quando uma ordem SAXO termina</span>
            </div>
            {!d.canEmail && <Notice tone="warning">O envio de emails não está disponível neste servidor: os avisos ficam só nesta página.</Notice>}
            {setEmail.error && <Notice tone="error">{errorMessage(setEmail.error)}</Notice>}
          </section>

          <section className="card" aria-labelledby="saxo-alert-list">
            <h2 id="saxo-alert-list" className="card-title">Avisos{unread > 0 ? ` (${unread} por ler)` : ''}</h2>
            {d.items.length === 0 ? (
              <EmptyState title="Sem avisos" action={<Link className="button" to="/saxo/ordens">Ver ordens SAXO</Link>}>
                Quando uma ordem enviada à SAXO for executada, expirar ou for cancelada, aparece aqui.
              </EmptyState>
            ) : (
              <div className="table-wrap" tabIndex={0} aria-label="Tabela de avisos SAXO">
                <table className="data">
                  <thead>
                    <tr><th scope="col">Data</th><th scope="col">Ordem</th><th scope="col" className="r">Quantidade</th><th scope="col" className="r">Preço</th><th scope="col">Email</th></tr>
                  </thead>
                  <tbody>
                    {d.items.map((i) => (
                      <tr key={i.id}>
                        <td className="small" style={{ whiteSpace: 'nowrap' }}>{f.dateTime(i.createdAt)}{!i.read && <> <span className="badge badge-accent">novo</span></>}</td>
                        <td>
                          <span className={`badge ${i.side === 'buy' ? 'badge-accent' : ''}`}>{orderLabel(i)}</span>{' '}
                          {i.symbol}
                          <div className="small">
                            <span className={`badge ${i.kind === 'filled' ? 'badge-positive' : ''}`}>{NOTICE_KIND[i.kind]}</span>
                            {i.kind === 'filled' && i.filledQuantity != null && <> {f.quantity(i.filledQuantity)} a {f.price(i.fillPrice)}</>}
                            <span className="muted">{i.saxoOrderId ? ` · SAXO ${i.saxoOrderId}` : ''}</span>
                          </div>
                        </td>
                        <td className="r">{f.quantity(i.quantity)}</td>
                        <td className="r">{i.limitPrice ? f.price(i.limitPrice) : i.stopPrice ? f.price(i.stopPrice) : <span className="muted">mercado</span>}</td>
                        <td className="small">{i.emailedAt ? `enviado ${f.dateTime(i.emailedAt)}` : <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
