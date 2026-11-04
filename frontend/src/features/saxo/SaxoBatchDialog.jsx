import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, newIdempotencyKey } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { DEFAULT_STOP_PCT, defaultLimit, defaultStop, signalsToOrders } from '../../lib/saxo.js';
import { Button, Dialog, Notice } from '../../components/ui/controls.jsx';
import { SIM_BANNER } from './SaxoOrderDialog.jsx';

const STATE = {
  idle: 'Por pré-validar', checking: 'A pré-validar…', ok: 'Pré-validada', problem: 'Recusada pela SAXO', error: 'Erro',
  sending: 'A enviar…', sent: 'Enviada', failed: 'Não enviada', skip: 'Ignorada',
};
const TONE = { ok: 'badge-accent', sent: 'badge-positive', problem: 'badge-warning', error: 'badge-negative', failed: 'badge-negative' };

/**
 * Sinais → ordens para a SAXO, em lote e sempre com confirmação: uma ordem limitada por instrumento (ao último preço),
 * pré-validadas uma a uma (a SAXO aceita 1 por segundo), e só as escolhidas são enviadas, também uma a uma.
 */
export default function SaxoBatchDialog({ open, onClose, signals, budget, strategyName }) {
  const qc = useQueryClient();
  const portfolio = useQuery({ queryKey: ['saxo-portfolio'], queryFn: () => api.get('/saxo/portfolio'), enabled: open, retry: false, refetchOnWindowFocus: false });
  const [rows, setRows] = useState([]);
  const [withStop, setWithStop] = useState(false);
  const [running, setRunning] = useState(null); // 'check' | 'send'
  // A lista de sinais lê-se só ao abrir (a página recria-a a cada render).
  const signalsRef = useRef(signals);
  signalsRef.current = signals;

  // As linhas montam-se uma vez por abertura: um refetch da carteira não apaga as pré-validações.
  const loaded = useRef(false);
  useEffect(() => {
    if (!open) { loaded.current = false; return; }
    if (!portfolio.data || loaded.current) return;
    loaded.current = true;
    setRows(signalsToOrders(signalsRef.current, portfolio.data.positions, budget).map((o) => ({
      ...o, key: newIdempotencyKey(), selected: !o.skip, state: o.skip ? 'skip' : 'idle', limitPrice: defaultLimit(o.price),
      stopPrice: defaultStop(o.price).price, preview: null, message: o.skip,
    })));
    setRunning(null);
  }, [open, portfolio.data, budget]);

  const update = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const params = (r) => ({
    instrumentId: r.signal.instrumentId, side: r.side, quantity: r.quantity, orderType: 'limit', limitPrice: r.limitPrice,
    ...(withStop && r.side === 'buy' ? { stop: { type: 'stop', price: r.stopPrice } } : {}),
  });

  async function checkAll() {
    setRunning('check');
    for (const [i, r0] of rows.entries()) {
      if (!r0.selected || r0.skip) continue;
      let r = { ...r0 };
      update(i, { state: 'checking', message: null });
      // Um preço fora do passo de preço é corrigido uma vez com a sugestão da SAXO (limite ou stop).
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const p = await api.post('/saxo/orders/preview', params(r));
          update(i, { ...r, preview: p, state: p.ok ? 'ok' : 'problem', message: p.ok ? null : p.problem });
          break;
        } catch (err) {
          if (err.code === 'SAXO_TICK_SIZE' && err.details?.suggested && attempt < 2) {
            r = err.details.field === 'stop' ? { ...r, stopPrice: err.details.suggested } : { ...r, limitPrice: err.details.suggested };
            continue;
          }
          update(i, { ...r, state: 'error', message: errorMessage(err) });
          break;
        }
      }
    }
    setRunning(null);
  }

  async function sendAll() {
    setRunning('send');
    for (const [i, r] of rows.entries()) {
      if (!r.selected || r.state !== 'ok') continue;
      update(i, { state: 'sending' });
      try {
        const res = await api.post('/saxo/orders', { ...params(r), confirmation: r.preview.confirmation, idempotencyKey: r.key });
        update(i, { state: 'sent', message: res.order.saxoOrderId ? `SAXO ${res.order.saxoOrderId}` : null });
      } catch (err) {
        update(i, { state: 'failed', message: errorMessage(err) });
      }
    }
    qc.invalidateQueries({ queryKey: ['saxo-orders'] });
    setRunning(null);
  }

  const ready = rows.filter((r) => r.selected && r.state === 'ok').length;
  const pending = rows.filter((r) => r.selected && ['idle', 'error', 'problem'].includes(r.state)).length;
  const sent = rows.filter((r) => r.state === 'sent').length;

  return (
    <Dialog open={open} onClose={running ? () => {} : onClose} title={`Enviar sinais da ${strategyName} à SAXO`}>
      <Notice tone="warning">{SIM_BANNER}</Notice>
      {portfolio.isPending ? <p className="small muted">A ler a carteira SAXO…</p> : portfolio.error ? <Notice tone="error">{errorMessage(portfolio.error)}</Notice> : (
        <>
          <p className="small muted">
            Uma ordem limitada por instrumento, ao último preço: compras e reforços pelo orçamento da estratégia ({f.money(budget, 'EUR', 0)}),
            vendas de tudo o que a conta SAXO tem. Pré-valide primeiro; depois escolha as ordens a enviar.
          </p>
          <label className="row small" style={{ gap: '0.5rem' }}>
            <input type="checkbox" checked={withStop} disabled={Boolean(running) || rows.some((r) => r.preview)} onChange={(e) => setWithStop(e.target.checked)} />
            Proteger as compras com um stop fixo {DEFAULT_STOP_PCT} % abaixo
          </label>
          {rows.length === 0 ? <p className="small muted">Não há sinais na lista actual.</p> : (
            <div className="table-wrap" tabIndex={0} aria-label="Ordens a enviar" style={{ maxHeight: '50vh', overflow: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col"><span className="visually-hidden">Escolher</span></th><th scope="col">Instrumento</th><th scope="col">Ordem</th>
                    <th scope="col" className="r">Quantidade</th><th scope="col" className="r">Preço limite</th><th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.signal.instrumentId}>
                      <td>
                        <input type="checkbox" aria-label={`Incluir ${r.signal.symbol}`} checked={r.selected} disabled={Boolean(r.skip) || Boolean(running) || ['sent', 'sending'].includes(r.state)}
                          onChange={(e) => update(i, { selected: e.target.checked })} />
                      </td>
                      <td>{r.signal.symbol}</td>
                      <td><span className={`badge ${r.side === 'buy' ? 'badge-accent' : ''}`}>{r.side === 'buy' ? 'Compra' : 'Venda'}</span>
                        {withStop && r.side === 'buy' && <div className="small muted">stop {f.price(r.stopPrice)}</div>}</td>
                      <td className="r">{r.quantity ? f.quantity(r.quantity) : '—'}</td>
                      <td className="r">{r.limitPrice ? f.price(r.limitPrice) : '—'}</td>
                      <td>
                        <span className={`badge ${TONE[r.state] ?? ''}`}>{STATE[r.state]}</span>
                        {r.message && <div className="small muted">{r.message}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sent > 0 && <Notice tone="info">{sent} {sent === 1 ? 'ordem enviada' : 'ordens enviadas'}. <Link to="/saxo/ordens" onClick={onClose}>Ver ordens SAXO</Link></Notice>}
          <div className="modal-actions">
            <Button onClick={onClose} disabled={Boolean(running)}>Fechar</Button>
            <Button onClick={checkAll} busy={running === 'check'} disabled={Boolean(running) || pending === 0}>Pré-validar ({pending})</Button>
            <Button variant="primary" onClick={sendAll} busy={running === 'send'} disabled={Boolean(running) || ready === 0}>Confirmar e enviar {ready} {ready === 1 ? 'ordem' : 'ordens'}</Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
