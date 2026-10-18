import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { keys, useAlertEvents, useAlerts } from '../../lib/queries.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Button, Dialog, Notice, Switch } from '../../components/ui/controls.jsx';
import Icon from '../../components/ui/Icon.jsx';
import AlertDialog from './AlertDialog.jsx';

const DELIVERY = {
  pending: { label: 'A aguardar envio', cls: '' },
  sending: { label: 'A enviar', cls: '' },
  sent: { label: 'Enviado', cls: 'badge-positive' },
  failed: { label: 'Falha de envio', cls: 'badge-negative' },
  uncertain: { label: 'Envio incerto', cls: 'badge-warning' },
};

function condition(rule) {
  const value = rule.kind.startsWith('close') ? f.money(rule.threshold, rule.currency || 'EUR') : `${f.number(rule.threshold)}%`;
  return `${f.ALERT_KIND_LABEL[rule.kind]} ${value}`;
}

export default function AlertsPage() {
  const rules = useAlerts();
  const events = useAlertEvents();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(null); // null | 'new' | regra
  const [deleting, setDeleting] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  async function setActive(rule, active) {
    setBusyId(rule.id);
    setError(null);
    try {
      await api.patch(`/alerts/${rule.id}`, { active });
      await qc.invalidateQueries({ queryKey: keys.alerts });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    const rule = deleting;
    setBusyId(rule.id);
    try {
      await api.del(`/alerts/${rule.id}`);
      await qc.invalidateQueries({ queryKey: keys.alerts });
      toast('Regra apagada');
      setDeleting(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Alertas</h1>
          <p className="page-sub">As condições são avaliadas com cotações diárias, não em tempo real.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}><Icon name="plus" size={18} />Criar alerta</Button>
      </div>

      <div className="stack">
        <Notice>
          Os alertas disparados são enviados num único email de resumo, após a actualização diária das cotações (dias úteis, por volta das 19h00).
          Nunca recebe mais do que um email por hora.
        </Notice>
        {error && <Notice tone="error">{error}</Notice>}

        <section className="card" aria-labelledby="rules-title">
          <div className="card-head"><h2 id="rules-title" className="card-title">Regras</h2></div>
          {rules.isPending ? <Loading /> : rules.error ? <ErrorState error={rules.error} onRetry={rules.refetch} /> :
            rules.data.items.length === 0 ? (
              <EmptyState title="Ainda não tem alertas" action={<Button onClick={() => setEditing('new')}>Criar o primeiro alerta</Button>}>
                Receba um email quando o fecho diário de um instrumento passar um valor ou variar uma percentagem.
              </EmptyState>
            ) : (
              <div className="table-wrap" tabIndex={0} aria-label="Tabela de regras">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Instrumento</th>
                      <th scope="col">Condição</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Último envio</th>
                      <th scope="col"><span className="visually-hidden">Acções</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.data.items.map((r) => (
                      <tr key={r.id}>
                        <td><Link to={`/instrumentos/${r.instrumentId}`} className="row-link">{r.symbol}</Link></td>
                        <td>{condition(r)}</td>
                        <td>
                          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                            <Switch checked={r.active} disabled={busyId === r.id} onChange={(v) => setActive(r, v)}
                              label={`${r.active ? 'Desactivar' : 'Activar'} alerta de ${r.symbol}`} />
                            <span className={`badge ${r.active ? 'badge-positive' : ''}`}>{r.active ? 'Activo' : 'Pausado'}</span>
                          </div>
                        </td>
                        <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{r.lastSentAt ? f.dateTime(r.lastSentAt) : 'Nunca'}</td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }}>
                          <Button size="small" variant="ghost" onClick={() => setEditing(r)}>Editar<span className="visually-hidden"> alerta de {r.symbol}</span></Button>
                          <Button size="small" variant="danger" className="button-ghost" onClick={() => setDeleting(r)}>Apagar<span className="visually-hidden"> alerta de {r.symbol}</span></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>

        <section className="card" aria-labelledby="events-title">
          <div className="card-head"><h2 id="events-title" className="card-title">Alertas disparados</h2></div>
          {events.isPending ? <Loading rows={2} /> : events.error ? <ErrorState error={events.error} onRetry={events.refetch} /> :
            events.data.items.length === 0 ? <p className="small muted">Ainda não disparou nenhum alerta.</p> : (
              <ul className="list">
                {events.data.items.map((e) => (
                  <li key={e.id} className="list-item">
                    <div>
                      <strong>{e.symbol}</strong> · {condition({ ...e, currency: 'EUR' })}
                      <div className="small muted">
                        Fecho de {f.price(e.close)} em {f.date(e.sessionDate)}{e.changePct != null && ` (${f.pct(Number(e.changePct).toFixed(2))})`}
                      </div>
                    </div>
                    <span className={`badge ${DELIVERY[e.deliveryStatus].cls}`}>{DELIVERY[e.deliveryStatus].label}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>

      <AlertDialog open={editing != null} onClose={() => setEditing(null)} rule={editing === 'new' ? null : editing} onDone={toast} />
      <Dialog open={deleting != null} onClose={() => setDeleting(null)} title="Apagar alerta?">
        {deleting && <p>A regra «{condition(deleting)}» para {deleting.symbol} será apagada, com o respectivo histórico de envios.</p>}
        <div className="modal-actions">
          <Button onClick={() => setDeleting(null)}>Cancelar</Button>
          <Button variant="danger" busy={busyId === deleting?.id} onClick={remove}>Apagar</Button>
        </div>
      </Dialog>
    </>
  );
}
