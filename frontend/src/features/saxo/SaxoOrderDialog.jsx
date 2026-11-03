import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, newIdempotencyKey } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { budgetQuantity } from '../../lib/trade.js';
import { confirmWaitMs, defaultLimit, normaliseLimit } from '../../lib/saxo.js';
import { Button, Dialog, Field, Notice, Segmented } from '../../components/ui/controls.jsx';

export const SIM_BANNER = 'Conta de simulação da SAXO Bank — não é dinheiro real.';

/** Estado do token da SAXO (partilhado com o cartão das Definições). */
export const useSaxoStatus = () => useQuery({
  queryKey: ['integration-saxo'], queryFn: () => api.get('/me/integrations/saxo'), staleTime: 60_000,
});

/**
 * Envio de uma ordem para a conta de simulação da SAXO, sempre em duas fases: «Pré-validar» (a SAXO verifica a ordem)
 * e «Confirmar e enviar» (com o código da pré-validação, que fica ligado a estes parâmetros).
 */
export default function SaxoOrderDialog({ open, onClose, instrument, initialSide = 'buy', initialQuantity = null }) {
  const qc = useQueryClient();
  const price = Number(instrument?.latest?.close);
  const [side, setSide] = useState(initialSide);
  const [qtyText, setQtyText] = useState('1');
  const [orderType, setOrderType] = useState('limit');
  const [limitText, setLimitText] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const [prev, setPrev] = useState(null); // { data, at }
  const [candidates, setCandidates] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [, tick] = useState(0);
  const start = useRef({});
  start.current = { qty: initialQuantity ?? (initialSide === 'buy' ? budgetQuantity(price) : 1), limit: defaultLimit(price) };

  useEffect(() => {
    if (open) {
      setSide(initialSide); setQtyText(String(Math.max(1, start.current.qty || 1))); setOrderType('limit'); setLimitText(start.current.limit);
      setKey(newIdempotencyKey()); setPrev(null); setCandidates(null); setError(null); setReceipt(null); setBusy(false);
    }
  }, [open, initialSide, initialQuantity, instrument?.id]);

  const qty = /^\d+$/.test(qtyText) ? Number(qtyText) : null;
  const qtyError = qtyText !== '' && (qty == null || qty < 1) ? 'Indique um número inteiro de unidades, a partir de 1.' : null;
  const limit = normaliseLimit(limitText);
  const limitError = orderType === 'limit' && limitText !== '' && !limit ? 'Indique um preço válido, por exemplo 12,34.' : null;
  const canPreview = qty >= 1 && (orderType === 'market' || limit);

  const params = () => ({ instrumentId: instrument.id, side, quantity: qty, orderType, ...(orderType === 'limit' ? { limitPrice: limit } : {}) });
  // Mudar qualquer parâmetro invalida a pré-validação (o código está ligado aos valores exactos).
  const edit = (fn) => (v) => { fn(v); setPrev(null); setCandidates(null); setError(null); setKey(newIdempotencyKey()); };

  const wait = prev ? confirmWaitMs(prev.at) : 0;
  useEffect(() => {
    if (!prev || wait <= 0) return undefined;
    const t = setTimeout(() => tick((n) => n + 1), wait + 20);
    return () => clearTimeout(t);
  }, [prev, wait]);

  async function validate() {
    setBusy(true); setError(null); setCandidates(null);
    try {
      setPrev({ data: await api.post('/saxo/orders/preview', params()), at: Date.now() });
    } catch (err) {
      if (err.code === 'SAXO_AMBIGUOUS') setCandidates(err.details?.candidates ?? []);
      setError(err);
      setPrev(null);
    } finally {
      setBusy(false);
    }
  }

  async function choose(uic) {
    setBusy(true); setError(null);
    try {
      await api.post(`/saxo/instruments/${instrument.id}/match`, { uic });
      setCandidates(null);
      await validate();
    } catch (err) {
      setError(err); setBusy(false);
    }
  }

  async function send() {
    setBusy(true); setError(null);
    try {
      const res = await api.post('/saxo/orders', { ...params(), confirmation: prev.data.confirmation, idempotencyKey: key });
      setReceipt(res.order);
      qc.invalidateQueries({ queryKey: ['saxo-orders'] });
    } catch (err) {
      // Numa falha de rede mantém-se a chave: repetir não duplica a ordem.
      setError(err);
      if (['SAXO_BAD_CONFIRMATION', 'SAXO_CONFIRMATION_EXPIRED', 'SAXO_DUPLICATE'].includes(err.code)) { setPrev(null); setKey(newIdempotencyKey()); }
    } finally {
      setBusy(false);
    }
  }

  const p = prev?.data;
  const sideLabel = side === 'buy' ? 'compra' : 'venda';
  const typeLabel = orderType === 'limit' ? 'limitada' : 'a mercado';

  return (
    <Dialog open={open} onClose={onClose} title={receipt ? 'Ordem enviada à SAXO Bank' : 'Enviar ordem à SAXO Bank'}>
      <Notice tone="warning">{SIM_BANNER}</Notice>
      {receipt ? (
        <>
          <dl className="summary-box">
            <dt>Estado</dt><dd>Aberta na SAXO (simulação)</dd>
            <dt>Instrumento</dt><dd>{receipt.symbol}</dd>
            <dt>Ordem</dt><dd>{receipt.side === 'buy' ? 'Compra' : 'Venda'} de {f.quantity(receipt.quantity)} {receipt.orderType === 'limit' ? `a ${f.price(receipt.limitPrice)} (limitada)` : '(a mercado)'}</dd>
            <dt>Número na SAXO</dt><dd>{receipt.saxoOrderId}</dd>
          </dl>
          <p className="small muted">É uma ordem do dia: se não for executada, expira no fim da sessão. Pode cancelá-la em «Ordens SAXO».</p>
          <div className="modal-actions">
            <Link className="button" to="/saxo/ordens" onClick={onClose}>Ver ordens SAXO</Link>
            <Button variant="primary" onClick={onClose}>Concluir</Button>
          </div>
        </>
      ) : instrument && (
        <>
          <div className="spread">
            <div>
              <strong>{instrument.symbol}</strong>
              {instrument.name && <span className="muted"> · {instrument.name}</span>}
              <div className="small muted">Último preço da aplicação: {price > 0 ? f.price(price, instrument.currency || 'EUR') : '—'}</div>
            </div>
            <Segmented label="Tipo de operação" value={side} onChange={edit(setSide)}
              options={[{ value: 'buy', label: 'Compra' }, { value: 'sell', label: 'Venda' }]} />
          </div>
          <Field label="Quantidade (unidades)" error={qtyError}>
            {(props) => <input {...props} className="input num" inputMode="numeric" autoComplete="off" value={qtyText} onChange={(e) => edit(setQtyText)(e.target.value.trim())} />}
          </Field>
          <div className="spread">
            <span className="small">Tipo de ordem</span>
            <Segmented label="Tipo de ordem" value={orderType} onChange={edit(setOrderType)}
              options={[{ value: 'limit', label: 'Limitada' }, { value: 'market', label: 'A mercado' }]} />
          </div>
          {orderType === 'limit' ? (
            <Field label="Preço limite" error={limitError} help="Por omissão, o último preço da aplicação. A SAXO verifica se respeita o passo de preço da bolsa.">
              {(props) => <input {...props} className="input num" inputMode="decimal" autoComplete="off" value={limitText} onChange={(e) => edit(setLimitText)(e.target.value)} />}
            </Field>
          ) : (
            <p className="small muted">A simulação da SAXO não tem preços de mercado: prefira ordens limitadas.</p>
          )}

          {p && (
            <dl className="summary-box" aria-live="polite">
              <dt>Instrumento na SAXO</dt><dd>{p.instrument.saxoSymbol}{p.instrument.exchangeId ? ` (${p.instrument.exchangeId})` : ''}</dd>
              <dt>Conta</dt><dd>{p.account.id}{p.account.isTrial ? ' · simulação' : ''}</dd>
              <dt>Ordem</dt><dd>{sideLabel} {typeLabel} de {f.quantity(p.quantity)}</dd>
              {p.limitPrice && <><dt>Preço limite</dt><dd>{f.price(p.limitPrice, p.currency)}</dd></>}
              <dt>Valor aproximado</dt><dd>{f.money(p.estimatedAmount, p.currency)}</dd>
              <dt>Pré-validação da SAXO</dt><dd>{p.ok ? 'Aceite' : 'Recusada'}</dd>
            </dl>
          )}
          {p && !p.ok && <Notice tone="warning">{p.problem}</Notice>}
          {candidates && (
            <div className="stack" style={{ gap: '0.5rem' }}>
              <p className="small">Escolha o instrumento da SAXO que corresponde a {instrument.symbol}:</p>
              {candidates.map((c) => (
                <Button key={c.uic} onClick={() => choose(c.uic)} disabled={busy}>
                  {c.symbol}{c.description ? ` · ${c.description}` : ''}{c.exchangeId ? ` (${c.exchangeId})` : ''}
                </Button>
              ))}
            </div>
          )}
          {error?.code === 'SAXO_TICK_SIZE' && error.details?.suggested && (
            <Button onClick={() => edit(setLimitText)(error.details.suggested)}>Usar {error.details.suggested}</Button>
          )}
          {error && !candidates && (
            <Notice tone="error">
              {errorMessage(error)}
              {['SAXO_NO_TOKEN', 'SAXO_TOKEN_EXPIRED'].includes(error.code) && <> <Link to="/definicoes" onClick={onClose}>Abrir Definições</Link></>}
            </Notice>
          )}

          <p className="small muted">
            Primeiro a SAXO pré-valida a ordem; só depois a pode confirmar. O valor é calculado com o preço da aplicação:
            a conta de simulação não tem preços de mercado.
          </p>
          <div className="modal-actions">
            <Button onClick={onClose}>Cancelar</Button>
            {p?.ok ? (
              <Button variant="primary" onClick={send} busy={busy} disabled={wait > 0}>
                {busy ? 'A enviar…' : `Confirmar e enviar ${sideLabel}`}
              </Button>
            ) : (
              <Button variant="primary" onClick={validate} busy={busy} disabled={!canPreview || Boolean(candidates)}>
                {busy ? 'A pré-validar…' : 'Pré-validar'}
              </Button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
