import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, newIdempotencyKey } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { budgetQuantity } from '../../lib/trade.js';
import { DEFAULT_STOP_PCT, defaultLimit, defaultStop, normaliseLimit } from '../../lib/saxo.js';
import { Button, Dialog, Field, Notice, Segmented } from '../../components/ui/controls.jsx';

export const SIM_BANNER = 'Conta de simulação da SAXO Bank — não é dinheiro real.';

/** Estado da ligação à SAXO (partilhado com o cartão das Definições). */
export const useSaxoStatus = () => useQuery({
  queryKey: ['integration-saxo'], queryFn: () => api.get('/me/integrations/saxo'), staleTime: 60_000,
});

/**
 * Envio de uma ordem para a conta de simulação da SAXO num só passo: o resumo mostra-se enquanto se preenche e «Confirmar e
 * enviar» envia logo. A API verifica a ordem (instrumento, tipo, passo de preço, stop, quantidade) e a SAXO valida-a ao
 * recebê-la; uma recusa fica «recusada» em Ordens SAXO com a mensagem da SAXO.
 */
export default function SaxoOrderDialog({ open, onClose, instrument, initialSide = 'buy', initialQuantity = null }) {
  const qc = useQueryClient();
  const price = Number(instrument?.latest?.close);
  const [side, setSide] = useState(initialSide);
  const [qtyText, setQtyText] = useState('1');
  const [orderType, setOrderType] = useState('limit');
  const [limitText, setLimitText] = useState('');
  const [stopOn, setStopOn] = useState(false);
  const [stopType, setStopType] = useState('stop');
  const [stopText, setStopText] = useState('');
  const [distText, setDistText] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const [sentStop, setSentStop] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const start = useRef({});
  start.current = { qty: initialQuantity ?? (initialSide === 'buy' ? budgetQuantity(price) : 1), limit: defaultLimit(price), stop: defaultStop(price) };

  useEffect(() => {
    if (open) {
      setSide(initialSide); setQtyText(String(Math.max(1, start.current.qty || 1))); setOrderType('limit'); setLimitText(start.current.limit);
      setStopOn(false); setStopType('stop'); setStopText(start.current.stop.price); setDistText(start.current.stop.distance);
      setKey(newIdempotencyKey()); setSentStop(null); setCandidates(null); setError(null); setReceipt(null); setBusy(false);
    }
  }, [open, initialSide, initialQuantity, instrument?.id]);

  const qty = /^\d+$/.test(qtyText) ? Number(qtyText) : null;
  const qtyError = qtyText !== '' && (qty == null || qty < 1) ? 'Indique um número inteiro de unidades, a partir de 1.' : null;
  const limit = normaliseLimit(limitText);
  const limitError = orderType === 'limit' && limitText !== '' && !limit ? 'Indique um preço válido, por exemplo 12,34.' : null;
  const withStop = side === 'buy' && stopOn;
  const stopPrice = normaliseLimit(stopText);
  const distance = normaliseLimit(distText);
  const stopError = withStop && stopType === 'stop' && stopText !== '' && !stopPrice ? 'Indique um preço válido.' : null;
  const distError = withStop && stopType === 'trailing' && distText !== '' && !distance ? 'Indique uma distância válida.' : null;
  const stopOk = !withStop || (stopType === 'stop' ? Boolean(stopPrice) : Boolean(distance));
  const canPreview = qty >= 1 && (orderType === 'market' || limit) && stopOk;

  const params = () => ({
    instrumentId: instrument.id, side, quantity: qty, orderType, ...(orderType === 'limit' ? { limitPrice: limit } : {}),
    ...(withStop ? { stop: stopType === 'stop' ? { type: 'stop', price: stopPrice } : { type: 'trailing', distance } } : {}),
  });
  // Mudar qualquer parâmetro é uma ordem nova (nova chave de idempotência).
  const edit = (fn) => (v) => { fn(v); setCandidates(null); setError(null); setKey(newIdempotencyKey()); };

  async function choose(uic) {
    setBusy(true); setError(null);
    try {
      await api.post(`/saxo/instruments/${instrument.id}/match`, { uic });
      setCandidates(null);
      await send();
    } catch (err) {
      setError(err); setBusy(false);
    }
  }

  async function send() {
    setBusy(true); setError(null);
    try {
      const body = params();
      const res = await api.post('/saxo/orders', { ...body, idempotencyKey: key });
      setSentStop(body.stop ?? null);
      setReceipt(res.order);
      qc.invalidateQueries({ queryKey: ['saxo-orders'] });
      qc.invalidateQueries({ queryKey: ['saxo-portfolio'] });
    } catch (err) {
      // Numa falha de rede mantém-se a chave: repetir não duplica a ordem. Uma recusa da SAXO já ficou registada como ordem
      // recusada: tentar de novo é uma ordem nova.
      if (err.code === 'SAXO_AMBIGUOUS') setCandidates(err.details?.candidates ?? []);
      setError(err);
      if (err.code === 'SAXO_DUPLICATE' || err.code === 'SAXO_REJECTED' || err.status === 409) setKey(newIdempotencyKey());
    } finally {
      setBusy(false);
    }
  }

  const refPrice = orderType === 'limit' ? Number(limit) : price;
  const estimate = qty && refPrice > 0 ? qty * refPrice : null;
  const sideLabel = side === 'buy' ? 'compra' : 'venda';
  const typeLabel = orderType === 'limit' ? 'limitada' : 'a mercado';
  // «Usar …» do erro de passo de preço preenche o campo indicado pelo servidor.
  const applySuggestion = () => {
    const { suggested, field } = error.details;
    if (field === 'stop') edit(setStopText)(suggested);
    else if (field === 'distance') edit(setDistText)(suggested);
    else edit(setLimitText)(suggested);
  };

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
            {sentStop && <><dt>Stop associado</dt><dd>{sentStop.type === 'stop' ? `a ${f.price(sentStop.price)}` : `móvel, ${f.price(sentStop.distance)} abaixo do mercado`}</dd></>}
          </dl>
          <p className="small muted">
            É uma ordem do dia: se não for executada, expira no fim da sessão. Pode alterá-la ou cancelá-la em «Ordens SAXO».
            {sentStop ? ' O stop fica activo quando a compra for executada e mantém-se até ser cancelado.' : ''}
          </p>
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
          {side === 'buy' && (
            <div className="stack" style={{ gap: '0.75rem' }}>
              <label className="row small" style={{ gap: '0.5rem' }}>
                <input type="checkbox" checked={stopOn} onChange={(e) => edit(setStopOn)(e.target.checked)} />
                Proteger com um stop (venda automática se o preço cair)
              </label>
              {stopOn && (
                <>
                  <Segmented label="Tipo de stop" value={stopType} onChange={edit(setStopType)}
                    options={[{ value: 'stop', label: 'Stop fixo' }, { value: 'trailing', label: 'Stop móvel' }]} />
                  {stopType === 'stop' ? (
                    <Field label="Preço do stop" error={stopError} help={`Por omissão ${DEFAULT_STOP_PCT} % abaixo do último preço. Vende se o preço descer até aqui.`}>
                      {(props) => <input {...props} className="input num" inputMode="decimal" autoComplete="off" value={stopText} onChange={(e) => edit(setStopText)(e.target.value)} />}
                    </Field>
                  ) : (
                    <Field label="Distância ao mercado" error={distError} help={`Por omissão ${DEFAULT_STOP_PCT} % do último preço. O stop sobe com o preço e nunca desce.`}>
                      {(props) => <input {...props} className="input num" inputMode="decimal" autoComplete="off" value={distText} onChange={(e) => edit(setDistText)(e.target.value)} />}
                    </Field>
                  )}
                </>
              )}
            </div>
          )}

          {canPreview && (
            <dl className="summary-box" aria-live="polite">
              <dt>Ordem</dt><dd>{sideLabel} {typeLabel} de {f.quantity(qty)} {instrument.symbol}</dd>
              {orderType === 'limit' && <><dt>Preço limite</dt><dd>{f.price(limit, instrument.currency || 'EUR')}</dd></>}
              {withStop && <><dt>Stop associado</dt><dd>{stopType === 'stop' ? `a ${f.price(stopPrice, instrument.currency || 'EUR')}` : `móvel, ${f.price(distance, instrument.currency || 'EUR')} abaixo do mercado`}</dd></>}
              <dt>Valor aproximado</dt><dd>{estimate == null ? '—' : f.money(estimate, instrument.currency || 'EUR')}</dd>
            </dl>
          )}
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
            <Button onClick={applySuggestion}>Usar {error.details.suggested}</Button>
          )}
          {error && !candidates && (
            <Notice tone="error">
              {errorMessage(error)}
              {['SAXO_NO_TOKEN', 'SAXO_TOKEN_EXPIRED'].includes(error.code) && <> <Link to="/definicoes" onClick={onClose}>Abrir Definições</Link></>}
            </Notice>
          )}

          <p className="small muted">
            «Confirmar e enviar» envia logo a ordem. A aplicação verifica o instrumento, o tipo de ordem, o passo de preço e a
            quantidade, e a SAXO valida a ordem ao recebê-la (se a recusar, fica «recusada» em Ordens SAXO, com o motivo). O valor é
            calculado com o preço da aplicação: a conta de simulação não tem preços de mercado.
          </p>
          <div className="modal-actions">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={send} busy={busy} disabled={!canPreview || Boolean(candidates)}>
              {busy ? 'A enviar…' : `Confirmar e enviar ${sideLabel}`}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
