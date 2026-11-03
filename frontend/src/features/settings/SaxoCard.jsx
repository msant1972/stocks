import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { Button, Field, Notice } from '../../components/ui/controls.jsx';

/**
 * Token de acesso do utilizador à SAXO Bank. Fica cifrado no servidor e nunca é mostrado de novo: a interface só sabe
 * se existe e quando foi guardado. Por agora a aplicação não o usa (as operações continuam simuladas).
 */
export default function SaxoCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['integration-saxo'], queryFn: () => api.get('/me/integrations/saxo') });
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { tone, text }
  const s = q.data;
  const clean = token.trim();
  const valid = /^[\x21-\x7e]+$/.test(clean);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      qc.setQueryData(['integration-saxo'], await api.put('/me/integrations/saxo', { token: clean }));
      setToken('');
      setResult({ tone: 'info', text: 'Token guardado (cifrado no servidor).' });
    } catch (err) {
      setResult({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setResult(null);
    try {
      await api.del('/me/integrations/saxo');
      await qc.invalidateQueries({ queryKey: ['integration-saxo'] });
      setResult({ tone: 'info', text: 'Token removido.' });
    } catch (err) {
      setResult({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="saxo-title">
      <h2 id="saxo-title" className="card-title">SAXO Bank</h2>
      <p className="small muted" style={{ margin: '0.25rem 0 1rem' }}>
        Token de acesso à sua conta SAXO Bank. Fica guardado cifrado no servidor e nunca é mostrado de novo.
        Por agora a aplicação não o usa: as operações continuam simuladas.
      </p>
      {q.isPending ? <p className="small muted">A carregar…</p> : q.error ? <Notice tone="error">{errorMessage(q.error)}</Notice> : (
        <form className="stack" style={{ gap: '1rem', maxWidth: '36rem' }} noValidate onSubmit={save}>
          <Field label="Token" error={clean && !valid ? 'O token não pode ter espaços nem caracteres especiais.' : null}
            help={s.configured ? `Definido em ${f.dateTime(s.updatedAt)}. Escreva um novo para o substituir.` : 'Cole aqui o token da SAXO Bank.'}>
            {(p) => (
              <input {...p} className="input" type="password" name="saxo-token" autoComplete="off" spellCheck={false}
                value={token} onChange={(e) => setToken(e.target.value)} placeholder={s.configured ? '••••••••••••' : ''} />
            )}
          </Field>
          {!s.canEncrypt && <Notice tone="warning">A chave de cifra do servidor não está configurada: não é possível guardar o token.</Notice>}
          {result && <Notice tone={result.tone}>{result.text}</Notice>}
          <div className="row">
            <Button type="submit" variant="primary" busy={busy} disabled={!clean || !valid || !s.canEncrypt}>Guardar</Button>
            {s.configured && <Button variant="ghost" onClick={remove} disabled={busy}>Remover token</Button>}
          </div>
        </form>
      )}
    </section>
  );
}
