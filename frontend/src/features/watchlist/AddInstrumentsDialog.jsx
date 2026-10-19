import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import { keys } from '../../lib/queries.js';
import { Button, Dialog, Field, Notice, Segmented } from '../../components/ui/controls.jsx';
import Icon from '../../components/ui/Icon.jsx';

const STATUS_LABEL = { new: 'Novo', exists: 'Já existe', duplicate: 'Repetido', error: 'Erro' };
const STATUS_CLASS = { new: 'badge-positive', exists: '', duplicate: 'badge-warning', error: 'badge-negative' };

/** Adicionar símbolos ao catálogo, à mão ou por importação de Excel/CSV com pré-visualização. */
export default function AddInstrumentsDialog({ open, onClose, onDone }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState('manual');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  function reset() {
    setText(''); setPreview(null); setError(null); setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }
  function close() { reset(); onClose(); }

  async function save(symbols, isinMics) {
    setBusy(true);
    setError(null);
    try {
      const { results } = await api.post('/instruments', { symbols, addToWatchlist: true, ...(isinMics ? { isinMics } : {}) });
      qc.invalidateQueries({ queryKey: keys.watchlist });
      qc.invalidateQueries({ queryKey: ['instruments'] });
      qc.invalidateQueries({ queryKey: keys.status });
      const created = results.filter((r) => r.result === 'created').length;
      const errors = results.filter((r) => r.result === 'error');
      if (errors.length) {
        setError(`Não foram aceites: ${errors.map((e) => e.symbol || '(vazio)').join(', ')}. Verifique o formato do símbolo.`);
        setBusy(false);
        return;
      }
      onDone(created ? `${created} ${created === 1 ? 'instrumento adicionado' : 'instrumentos adicionados'}; a validação no fornecedor demora alguns minutos.` : 'Os instrumentos já existiam e foram associados à sua lista.');
      close();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    const form = new FormData();
    form.append('file', file);
    try {
      setPreview(await api.post('/instruments/import/preview', form));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const manualSymbols = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const importableRows = preview?.rows.filter((r) => r.status === 'new' || r.status === 'exists') ?? [];
  const importable = importableRows.map((r) => r.symbol);
  const importIsinMics = Object.fromEntries(importableRows.filter((r) => r.isinMic).map((r) => [r.symbol, r.isinMic]));

  return (
    <Dialog open={open} onClose={close} title="Adicionar instrumentos">
      <Segmented label="Forma de adicionar" value={mode} onChange={(m) => { reset(); setMode(m); }}
        options={[{ value: 'manual', label: 'Introduzir símbolos' }, { value: 'import', label: 'Importar Excel' }]} />

      {mode === 'manual' ? (
        <Field label="Símbolos Yahoo" help="Um ou mais símbolos, separados por espaços ou vírgulas, com o sufixo do mercado. Ex.: GALP.LS, SIE.DE, ASML.AS. Só são aceites instrumentos cotados em EUR.">
          {(p) => <textarea {...p} className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="GALP.LS SIE.DE" />}
        </Field>
      ) : (
        <>
          <p className="small muted">
            Ficheiro .xlsx ou .csv com uma coluna <strong>ticker</strong> e, opcionalmente, <strong>isin_mic</strong> (ex.: PTGAL0AM0009-XLIS, também aplicado a instrumentos já existentes). Até 1000 linhas. Nome, mercado e moeda vêm do fornecedor.
          </p>
          <div className="row">
            <label className="button">
              <Icon name="upload" size={18} />Escolher ficheiro
              <input ref={fileRef} type="file" accept=".xlsx,.csv" className="visually-hidden" onChange={(e) => upload(e.target.files[0])} />
            </label>
            <a className="button button-ghost" href="/api/v1/instruments/import/template" download>
              <Icon name="download" size={18} />Descarregar modelo
            </a>
          </div>
          {preview && (
            <>
              <p className="small" aria-live="polite">
                {preview.summary.new} novos · {preview.summary.exists} já existentes · {preview.summary.duplicate} repetidos · {preview.summary.error} com erro
              </p>
              <div className="table-wrap" tabIndex={0} style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table className="data">
                  <caption className="visually-hidden">Pré-visualização da importação</caption>
                  <thead><tr><th scope="col">Linha</th><th scope="col">Símbolo</th><th scope="col">ISIN-MIC</th><th scope="col">Estado</th></tr></thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.line}>
                        <td className="num">{r.line}</td>
                        <td>{r.symbol || '—'}</td>
                        <td className="small num">{r.isinMic ?? '—'}</td>
                        <td><span className={`badge ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span> <span className="small muted">{r.message}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      <div className="modal-actions">
        <Button onClick={close}>Cancelar</Button>
        {mode === 'manual' ? (
          <Button variant="primary" busy={busy} disabled={!manualSymbols.length} onClick={() => save(manualSymbols)}>
            Adicionar {manualSymbols.length > 1 ? `${manualSymbols.length} símbolos` : ''}
          </Button>
        ) : (
          <Button variant="primary" busy={busy} disabled={!importable.length} onClick={() => save(importable, Object.keys(importIsinMics).length ? importIsinMics : undefined)}>
            Importar {importable.length || ''} {importable.length === 1 ? 'símbolo' : 'símbolos'}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
