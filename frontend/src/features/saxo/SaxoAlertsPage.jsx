import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
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
          <p className="page-sub">Avisos de ordens enviadas à SAXO Bank que já não estão abertas: foram executadas, expiraram ou foram canceladas fora da aplicação.</p>
        </div>
        {unread > 0 && <Button onClick={() => markRead.mutate()} busy={markRead.isPending}>Marcar como lidos</Button>}
      </div>

      {q.isPending ? <Loading rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <section className="card" aria-labelledby="saxo-alert-pref">
            <h2 id="saxo-alert-pref" className="card-title">Email</h2>
            <p className="small muted" style={{ margin: '0.25rem 0 1rem' }}>
              A aplicação confronta a cada minuto as suas ordens abertas com a SAXO e envia-lhe um email quando alguma deixa de estar aberta.
              Confirme sempre o resultado na plataforma da SAXO.
            </p>
            <div className="row">
              <Switch checked={d.emailEnabled} onChange={(v) => setEmail.mutate(v)} disabled={setEmail.isPending} label="Receber email quando uma ordem SAXO deixa de estar aberta" />
              <span aria-hidden="true">Receber email quando uma ordem SAXO deixa de estar aberta</span>
            </div>
            {!d.canEmail && <Notice tone="warning">O envio de emails não está disponível neste servidor: os avisos ficam só nesta página.</Notice>}
            {setEmail.error && <Notice tone="error">{errorMessage(setEmail.error)}</Notice>}
          </section>

          <section className="card" aria-labelledby="saxo-alert-list">
            <h2 id="saxo-alert-list" className="card-title">Avisos{unread > 0 ? ` (${unread} por ler)` : ''}</h2>
            {d.items.length === 0 ? (
              <EmptyState title="Sem avisos" action={<Link className="button" to="/saxo/ordens">Ver ordens SAXO</Link>}>
                Quando uma ordem aberta deixar de estar aberta na SAXO, aparece aqui.
              </EmptyState>
            ) : (
              <div className="table-wrap" tabIndex={0} aria-label="Tabela de avisos SAXO">
                <table className="data">
                  <thead>
                    <tr><th scope="col">Data</th><th scope="col">Ordem</th><th scope="col" className="r">Quantidade</th><th scope="col" className="r">Preço limite</th><th scope="col">Email</th></tr>
                  </thead>
                  <tbody>
                    {d.items.map((i) => (
                      <tr key={i.id}>
                        <td className="small" style={{ whiteSpace: 'nowrap' }}>{f.dateTime(i.createdAt)}{!i.read && <> <span className="badge badge-accent">novo</span></>}</td>
                        <td>
                          <span className={`badge ${i.side === 'buy' ? 'badge-accent' : ''}`}>{i.side === 'buy' ? 'Compra' : 'Venda'} {i.orderType === 'limit' ? 'limitada' : 'a mercado'}</span>{' '}
                          {i.symbol}
                          <div className="small muted">Já não está aberta{i.saxoOrderId ? ` · SAXO ${i.saxoOrderId}` : ''}</div>
                        </td>
                        <td className="r">{f.quantity(i.quantity)}</td>
                        <td className="r">{i.limitPrice ? f.price(i.limitPrice) : <span className="muted">mercado</span>}</td>
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
