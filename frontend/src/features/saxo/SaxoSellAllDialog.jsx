import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, newIdempotencyKey } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { openBuyOrders, sellAllPlan } from '../../lib/saxo.js';
import { Button, Dialog, Notice } from '../../components/ui/controls.jsx';
import { SIM_BANNER } from './SaxoOrderDialog.jsx';

const STATE = { idle: 'Por enviar', sending: 'A enviar…', sent: 'Enviada', failed: 'Não enviada' };
const TONE = { sent: 'badge-positive', failed: 'badge-negative' };

/**
 * «Vender Tudo»: botão de emergência da Carteira SAXO. Vende a mercado todas as posições da conta (uma ordem por instrumento,
 * uma a uma: a SAXO aceita 1 por segundo). Antes, e por omissão, desliga a Automação (senão voltava a comprar na hora seguinte)
 * e cancela as compras ainda abertas. Cada ordem fica registada como qualquer outra e a SAXO valida-a ao recebê-la.
 */
export default function SaxoSellAllDialog({ open, onClose, positions }) {
  const qc = useQueryClient();
  const plan = sellAllPlan(positions);
  const orders = useQuery({ queryKey: ['saxo-orders', 'open-buys'], queryFn: () => api.get('/saxo/orders?limit=200'), enabled: open, retry: false });
  const automation = useQuery({ queryKey: ['saxo-automation'], queryFn: () => api.get('/saxo/automation'), enabled: open, retry: false });
  const buys = openBuyOrders(orders.data?.items);
  const [stopAuto, setStopAuto] = useState(true);
  const [cancelBuys, setCancelBuys] = useState(true);
  const [rows, setRows] = useState(null); // estado de cada venda depois de começar
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const started = rows != null;
  const shown = rows ?? plan.orders.map((o) => ({ ...o, state: 'idle', message: null }));

  async function run() {
    setRunning(true);
    setLog([]);
    const say = (text, tone) => setLog((l) => [...l, { text, tone }]);
    let list = plan.orders.map((o) => ({ ...o, key: newIdempotencyKey(), state: 'idle', message: null }));
    setRows(list);
    const patch = (i, p) => { list = list.map((r, j) => (j === i ? { ...r, ...p } : r)); setRows(list); };
    if (stopAuto && automation.data?.enabled) {
      try { await api.put('/saxo/automation', { enabled: false }); say('Automação desligada.'); } catch (err) { say(`Não foi possível desligar a Automação: ${errorMessage(err)}`, 'badge-negative'); }
    }
    if (cancelBuys && buys.length) {
      let done = 0;
      for (const o of buys) {
        try { await api.del(`/saxo/orders/${o.id}`); done += 1; } catch (err) { say(`Compra ${o.symbol} não cancelada: ${errorMessage(err)}`, 'badge-negative'); }
      }
      say(`${done} de ${buys.length} compras abertas canceladas.`);
    }
    for (const [i, r] of list.entries()) {
      patch(i, { state: 'sending' });
      try {
        const res = await api.post('/saxo/orders', { instrumentId: r.instrumentId, side: 'sell', quantity: r.quantity, orderType: 'market', idempotencyKey: r.key });
        patch(i, { state: 'sent', message: res.order.saxoOrderId ? `SAXO ${res.order.saxoOrderId}` : null });
      } catch (err) {
        patch(i, { state: 'failed', message: errorMessage(err) });
      }
    }
    qc.invalidateQueries({ queryKey: ['saxo-orders'] });
    qc.invalidateQueries({ queryKey: ['saxo-portfolio'] });
    qc.invalidateQueries({ queryKey: ['saxo-automation'] });
    setRunning(false);
  }

  const failed = shown.filter((r) => r.state === 'failed').length;
  const sent = shown.filter((r) => r.state === 'sent').length;
  const finished = started && !running;

  return (
    <Dialog open={open} onClose={running ? () => {} : onClose} title="Vender tudo na SAXO">
      <Notice tone="warning">{SIM_BANNER}</Notice>
      <Notice tone="error">
        Emergência: vende a mercado todas as posições da conta, ao preço que o mercado der. Não se pode desfazer.
      </Notice>
      {plan.orders.length === 0 ? <p className="small muted">A conta não tem posições para vender.</p> : (
        <>
          {!started && (
            <div className="stack" style={{ gap: '0.375rem' }}>
              <label className="row small" style={{ gap: '0.5rem' }}>
                <input type="checkbox" checked={stopAuto} onChange={(e) => setStopAuto(e.target.checked)} />
                Desligar também a Automação{automation.data && !automation.data.enabled ? ' (já está desligada)' : ' (senão voltava a comprar na hora seguinte)'}
              </label>
              <label className="row small" style={{ gap: '0.5rem' }}>
                <input type="checkbox" checked={cancelBuys} onChange={(e) => setCancelBuys(e.target.checked)} />
                Cancelar as compras ainda abertas ({orders.isPending ? '…' : buys.length})
              </label>
            </div>
          )}
          <div className="table-wrap" tabIndex={0} aria-label="Vendas a enviar" style={{ maxHeight: '40vh', overflow: 'auto' }}>
            <table className="data">
              <thead>
                <tr><th scope="col">Instrumento</th><th scope="col" className="r">Quantidade</th><th scope="col" className="r">Valor</th><th scope="col">Estado</th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.instrumentId}>
                    <td>{r.symbol}{r.name && <div className="small muted">{r.name}</div>}</td>
                    <td className="r num">{f.quantity(r.quantity)}</td>
                    <td className="r num">{r.marketValue ? f.money(r.marketValue, r.currency) : '—'}</td>
                    <td>
                      <span className={`badge ${TONE[r.state] ?? ''}`}>{STATE[r.state]}</span>
                      {r.message && <div className="small muted">{r.message}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.skipped.length > 0 && (
            <Notice tone="warning">Sem correspondência na aplicação (venda na plataforma da SAXO): {plan.skipped.join(', ')}.</Notice>
          )}
          {log.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: '1.25rem' }}>{log.map((l, i) => <li key={i} className={l.tone ? 'negative' : undefined}>{l.text}</li>)}</ul>}
          {finished && (
            <Notice tone={failed ? 'warning' : 'info'}>
              {sent} de {shown.length} vendas enviadas{failed ? `; ${failed} recusadas (ver o motivo na linha). Confirme as ordens em «Ordens SAXO» e na plataforma da SAXO.` : '. Confirme as execuções em «Ordens SAXO»: as ordens a mercado executam com a bolsa aberta.'}
            </Notice>
          )}
        </>
      )}
      <div className="modal-actions">
        <Button onClick={onClose} disabled={running}>{finished ? 'Fechar' : 'Cancelar'}</Button>
        {!finished && plan.orders.length > 0 && (
          <Button variant="danger" className="button-danger-solid" busy={running} onClick={run}>
            Vender tudo ({plan.orders.length} {plan.orders.length === 1 ? 'instrumento' : 'instrumentos'})
          </Button>
        )}
      </div>
    </Dialog>
  );
}
