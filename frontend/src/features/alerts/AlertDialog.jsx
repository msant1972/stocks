import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { keys, useWatchlist } from '../../lib/queries.js';
import { Button, Dialog, Field, Notice } from '../../components/ui/controls.jsx';

const KINDS = [
  { value: 'close_above', label: 'Fecho acima de um valor', unit: '€' },
  { value: 'close_below', label: 'Fecho abaixo de um valor', unit: '€' },
  { value: 'change_up', label: 'Subida diária de pelo menos', unit: '%' },
  { value: 'change_down', label: 'Descida diária de pelo menos', unit: '%' },
];

/** Criar ou editar uma regra. instrument fixa o instrumento; rule activa o modo de edição. */
export default function AlertDialog({ open, onClose, instrument, rule, onDone }) {
  const qc = useQueryClient();
  const wl = useWatchlist();
  const [instrumentId, setInstrumentId] = useState('');
  const [kind, setKind] = useState('close_above');
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setInstrumentId(String(rule?.instrumentId ?? instrument?.id ?? ''));
    setKind(rule?.kind ?? 'close_above');
    setThreshold(rule ? rule.threshold.replace('.', ',') : '');
    setError(null);
    setBusy(false);
  }, [open, rule, instrument]);

  const options = wl.data?.items.filter((i) => i.status !== 'invalid') ?? [];
  const selected = instrument ?? options.find((i) => String(i.id) === instrumentId) ?? (rule && { symbol: rule.symbol, currency: rule.currency });
  const normalised = threshold.trim().replace(/\s/g, '').replace(',', '.');
  const valid = /^\d{1,12}(\.\d{1,6})?$/.test(normalised) && Number(normalised) > 0;
  const unit = KINDS.find((k) => k.value === kind).unit;
  const sentence = valid ? f.describeRule(kind, normalised, selected?.symbol, selected?.currency || 'EUR') : null;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (rule) await api.patch(`/alerts/${rule.id}`, { kind, threshold: normalised });
      else await api.post('/alerts', { instrumentId: Number(instrumentId), kind, threshold: normalised });
      qc.invalidateQueries({ queryKey: keys.alerts });
      onDone?.(rule ? 'Regra actualizada' : 'Alerta criado');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={rule ? 'Editar alerta' : 'Criar alerta'}>
      <form onSubmit={save} className="stack" style={{ gap: '1rem' }} noValidate>
        {instrument || rule ? (
          <p><strong>{selected?.symbol}</strong>{selected?.name && <span className="muted"> · {selected.name}</span>}</p>
        ) : (
          <Field label="Instrumento" help={options.length ? null : 'Adicione primeiro instrumentos à sua lista.'}>
            {(p) => (
              <select {...p} className="select" value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} required>
                <option value="">Escolha um instrumento</option>
                {options.map((i) => <option key={i.id} value={i.id}>{i.symbol}{i.name ? ` — ${i.name}` : ''}</option>)}
              </select>
            )}
          </Field>
        )}
        <Field label="Condição">
          {(p) => (
            <select {...p} className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          )}
        </Field>
        <Field label={`Valor (${unit === '€' ? 'EUR' : '%'})`} error={threshold && !valid ? 'Indique um número positivo, ex.: 15,50.' : null}>
          {(p) => <input {...p} className="input num" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder={unit === '€' ? '15,50' : '3'} />}
        </Field>
        {sentence && <p className="notice" aria-live="polite">{sentence}</p>}
        <p className="small muted">
          As condições são avaliadas com cotações diárias, não em tempo real. Os alertas disparados são enviados num único email de resumo,
          após a actualização diária das cotações.
          {(kind === 'close_above' || kind === 'close_below') && ' Um alerta de valor é enviado quando a condição passa a verificar-se, e não todos os dias enquanto se mantém.'}
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="modal-actions">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!valid || !(rule || instrumentId)}>
            {rule ? 'Guardar' : 'Criar alerta'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
