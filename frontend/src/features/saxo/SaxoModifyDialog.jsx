import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { normaliseLimit, orderLabel } from '../../lib/saxo.js';
import { Button, Dialog, Field, Notice } from '../../components/ui/controls.jsx';
import { SIM_BANNER } from './SaxoOrderDialog.jsx';

/** Alterar uma ordem aberta: quantidade e preço limite (limitadas) ou preço do stop fixo. Sempre com confirmação. */
export default function SaxoModifyDialog({ order, onClose }) {
  const qc = useQueryClient();
  const isStop = order?.orderType === 'stop';
  const current = order ? (isStop ? order.stopPrice : order.limitPrice) : null;
  const [qtyText, setQtyText] = useState('');
  const [priceText, setPriceText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (order) { setQtyText(String(order.quantity)); setPriceText(String(Number(current))); setError(null); setBusy(false); }
  }, [order, current]);

  const qty = /^\d+$/.test(qtyText) ? Number(qtyText) : null;
  const price = normaliseLimit(priceText);
  const changed = order && (qty !== order.quantity || Number(price) !== Number(current));
  const valid = qty >= 1 && price;

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.patch(`/saxo/orders/${order.id}`, { ...(qty !== order.quantity ? { quantity: qty } : {}), ...(Number(price) !== Number(current) ? { price } : {}) });
      await qc.invalidateQueries({ queryKey: ['saxo-orders'] });
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(order)} onClose={onClose} title="Alterar ordem SAXO">
      {order && (
        <>
          <Notice tone="warning">{SIM_BANNER}</Notice>
          <p><strong>{order.symbol}</strong> · {orderLabel(order)} de {f.quantity(order.quantity)} a {f.price(current)}{order.saxoOrderId ? <span className="muted"> · SAXO {order.saxoOrderId}</span> : null}</p>
          <Field label="Quantidade (unidades)" help={isStop ? 'A quantidade do stop acompanha a da compra.' : null}
            error={qtyText !== '' && !(qty >= 1) ? 'Indique um número inteiro de unidades, a partir de 1.' : null}>
            {(p) => <input {...p} className="input num" inputMode="numeric" autoComplete="off" disabled={isStop} value={qtyText} onChange={(e) => setQtyText(e.target.value.trim())} />}
          </Field>
          <Field label={isStop ? 'Preço do stop' : 'Preço limite'} error={priceText !== '' && !price ? 'Indique um preço válido.' : null}>
            {(p) => <input {...p} className="input num" inputMode="decimal" autoComplete="off" value={priceText} onChange={(e) => setPriceText(e.target.value)} />}
          </Field>
          {error?.code === 'SAXO_TICK_SIZE' && error.details?.suggested && (
            <Button onClick={() => setPriceText(error.details.suggested)}>Usar {error.details.suggested}</Button>
          )}
          {error && <Notice tone="error">{errorMessage(error)}</Notice>}
          <div className="modal-actions">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={save} busy={busy} disabled={!valid || !changed}>Confirmar alteração</Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
