import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, newIdempotencyKey } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { keys } from '../../lib/queries.js';
import { STRATEGY_BUDGET } from '../../lib/strategy.js';
import { budgetQuantity } from '../../lib/trade.js';
import { Button, Dialog, Field, Notice, Segmented } from '../../components/ui/controls.jsx';

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Compra ou venda simulada (guia, secção 5.5). O total mostrado é uma pré-visualização: o servidor
 * volta a validar preço, saldo e quantidade, e pede nova confirmação se a cotação tiver mudado.
 */
export default function TradeDialog({ open, onClose, instrument, initialSide = 'buy', initialQuantity = null, quantityNote = null }) {
  const qc = useQueryClient();
  // Sem quantidade pedida, a compra começa com o equivalente ao orçamento das estratégias (15 000 €) ao último preço.
  const price = Number(instrument?.latest?.close);
  const budgeted = initialQuantity == null && initialSide === 'buy' && price > 0;
  const startQuantity = initialQuantity ?? (initialSide === 'buy' ? budgetQuantity(price) : 1);
  const start = useRef(startQuantity);
  start.current = startQuantity; // lido só ao abrir, para uma cotação nova não apagar o que o utilizador escreveu
  const defaultNote = quantityNote ?? (budgeted ? `≈ ${f.money(STRATEGY_BUDGET, 'EUR', 0)} (orçamento por compra) ao último preço disponível.` : null);
  const [side, setSide] = useState(initialSide);
  const [qtyText, setQtyText] = useState('1');
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    if (open) {
      setSide(initialSide); setQtyText(String(Math.max(1, start.current || 1))); setReceipt(null); setError(null); setNotice(null); setKey(newIdempotencyKey());
    }
  }, [open, initialSide, initialQuantity, instrument?.id]);

  const qty = /^\d+$/.test(qtyText) ? Number(qtyText) : null;
  const qtyError = qtyText !== '' && (qty == null || qty < 1) ? 'Indique um número inteiro de unidades, a partir de 1.' : null;
  const debouncedQty = useDebounced(qty, 250);

  const preview = useQuery({
    queryKey: ['trade-preview', instrument?.id, side, debouncedQty],
    queryFn: () => api.get(`/simulated-trades/preview?instrumentId=${instrument.id}&side=${side}&quantity=${debouncedQty}`),
    enabled: open && !!instrument && debouncedQty != null && debouncedQty >= 1,
    staleTime: 0,
  });

  const changeSide = (s) => { setSide(s); setKey(newIdempotencyKey()); setError(null); setNotice(null); };
  const changeQty = (v) => { setQtyText(v.trim()); setKey(newIdempotencyKey()); setError(null); setNotice(null); };

  const p = preview.data;
  const ready = p && !p.error && qty === debouncedQty && !preview.isFetching;
  const sideLabel = side === 'buy' ? 'compra' : 'venda';

  async function confirm() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post('/simulated-trades', {
        instrumentId: instrument.id, side, quantity: qty, idempotencyKey: key,
        expectedPrice: p.price, expectedQuoteDate: p.quoteDate,
      });
      setReceipt(res.trade);
      setKey(newIdempotencyKey());
      qc.invalidateQueries({ queryKey: keys.portfolio });
      qc.invalidateQueries({ queryKey: ['trades'] });
    } catch (err) {
      if (err.code === 'PRICE_CHANGED') {
        setNotice('A cotação mudou desde a pré-visualização. Reveja os valores e confirme de novo.');
        setKey(newIdempotencyKey());
        await preview.refetch();
      } else {
        // Numa falha de rede mantém-se a chave: repetir não duplica a operação.
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const title = receipt ? 'Operação simulada registada' : side === 'buy' ? 'Simular compra' : 'Simular venda';

  const body = receipt && (
        <>
          <dl className="summary-box">
            <dt>Operação</dt><dd>{receipt.side === 'buy' ? 'Compra simulada' : 'Venda simulada'}</dd>
            <dt>Instrumento</dt><dd>{receipt.symbol}</dd>
            <dt>Quantidade</dt><dd>{f.quantity(receipt.quantity)}</dd>
            <dt>Preço aplicado</dt><dd>{f.price(receipt.price, receipt.currency)}</dd>
            <dt>Cotação de</dt><dd>{f.date(receipt.quoteDate)}</dd>
            <dt>Total</dt><dd>{f.money(receipt.amount, receipt.currency)}</dd>
            {receipt.realizedPnl != null && <><dt>Resultado realizado</dt><dd>{f.signedMoney(receipt.realizedPnl, receipt.currency)}</dd></>}
            <dt>Referência</dt><dd>#{receipt.id}</dd>
          </dl>
          <p className="small muted">Esta operação é virtual e não foi enviada para a bolsa.</p>
          <div className="modal-actions">
            <Link className="button" to="/operacoes" onClick={onClose}>Ver operações</Link>
            <Button variant="primary" onClick={onClose}>Concluir</Button>
          </div>
        </>
  );

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {body ?? (instrument && (
        <>
          <div className="spread">
            <div>
              <strong>{instrument.symbol}</strong>
              {instrument.name && <span className="muted"> · {instrument.name}</span>}
              <div className="small muted">Moeda: {instrument.currency || 'EUR'}</div>
            </div>
            <Segmented label="Tipo de operação" value={side} onChange={changeSide}
              options={[{ value: 'buy', label: 'Compra' }, { value: 'sell', label: 'Venda' }]} />
          </div>

          <Field label="Quantidade (unidades)" error={qtyError}
            help={[side === initialSide ? defaultNote : null, side === 'sell' && p ? `Após a venda ficará com ${f.quantity(Math.max(p.quantityAfter, 0))} unidades.` : null].filter(Boolean).join(' ') || null}>
            {(props) => (
              <input {...props} className="input num" inputMode="numeric" autoComplete="off"
                value={qtyText} onChange={(e) => changeQty(e.target.value)} />
            )}
          </Field>

          {preview.isError && <Notice tone="error">{errorMessage(preview.error)}</Notice>}
          {p && (
            <dl className="summary-box" aria-live="polite">
              <dt>Último preço disponível</dt><dd>{f.price(p.price, p.currency)}</dd>
              <dt>Data da cotação</dt><dd>{f.date(p.quoteDate)}</dd>
              <dt>Total (pré-visualização)</dt><dd>{f.money(p.amount, p.currency)}</dd>
              <dt>Saldo após a operação</dt><dd>{f.money(p.cashAfter, p.currency)}</dd>
              <dt>Unidades após a operação</dt><dd>{f.quantity(Math.max(p.quantityAfter, 0))}</dd>
            </dl>
          )}
          {p?.error && <Notice tone="warning">{errorMessage(p.error)}</Notice>}
          {notice && <Notice tone="warning">{notice}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}

          <p className="small muted">
            Esta operação é virtual e não é enviada para a bolsa. É executada, de forma simplificada, ao último preço disponível: durante a sessão, o valor provisório mais recente (actualizado de hora a hora, com cerca de 20 minutos de atraso); depois do fecho, o fecho do dia.
          </p>
          <div className="modal-actions">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={confirm} disabled={!ready} busy={busy}>
              {busy ? 'A registar…' : `Confirmar ${sideLabel} simulada`}
            </Button>
          </div>
        </>
      ))}
    </Dialog>
  );
}
