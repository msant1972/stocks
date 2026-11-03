import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { expiryText } from '../../lib/saxo.js';
import { Button, Field, Notice } from '../../components/ui/controls.jsx';

/**
 * Token de acesso do utilizador à SAXO Bank. Fica cifrado no servidor e nunca é mostrado de novo: a interface só sabe
 * se existe, quando foi guardado e quando expira (o token do portal dura 24 h). Serve para enviar ordens para a
 * conta de simulação (SIM) da SAXO; a conta real não está activada.
 */
export default function SaxoCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['integration-saxo'], queryFn: () => api.get('/me/integrations/saxo') });
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // { tone, text }
  const s = q.data;
  const clean = token.trim();
  const valid = /^[\x21-\x7e]+$/.test(clean);
  const expiry = s?.configured ? expiryText(s.expiresAt) : null;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      qc.setQueryData(['integration-saxo'], await api.put('/me/integrations/saxo', { token: clean }));
      setToken('');
      qc.invalidateQueries({ queryKey: ['saxo-connection'] });
      setResult({ tone: 'info', text: 'Token guardado (cifrado no servidor). Use «Testar ligação» para confirmar.' });
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

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const c = await api.get('/saxo/connection');
      setResult({ tone: 'info', text: `Ligação OK: conta ${c.accountId}${c.isTrial ? ' (simulação)' : ''}, saldo ${c.cashBalance == null ? '—' : f.money(c.cashBalance, c.currency)}.` });
    } catch (err) {
      setResult({ tone: 'error', text: errorMessage(err) });
    } finally {
      qc.invalidateQueries({ queryKey: ['integration-saxo'] }); // um 401 marca o token como expirado
      setTesting(false);
    }
  }

  return (
    <section className="card" aria-labelledby="saxo-title">
      <div className="spread">
        <h2 id="saxo-title" className="card-title">SAXO Bank</h2>
        <span className="badge badge-warning">Simulação (SIM)</span>
      </div>
      <p className="small muted" style={{ margin: '0.25rem 0 1rem' }}>
        Token de acesso à conta de simulação da SAXO Bank (gerado no portal de programadores, dura 24 h). Fica guardado cifrado no
        servidor e nunca é mostrado de novo. Serve para enviar ordens para a conta de simulação, sempre com uma pré-validação e uma
        confirmação; a conta real não está activada. As compras e vendas simuladas da aplicação continuam a ser virtuais.
      </p>
      {q.isPending ? <p className="small muted">A carregar…</p> : q.error ? <Notice tone="error">{errorMessage(q.error)}</Notice> : (
        <form className="stack" style={{ gap: '1rem', maxWidth: '36rem' }} noValidate onSubmit={save}>
          <Field label="Token" error={clean && !valid ? 'O token não pode ter espaços nem caracteres especiais.' : null}
            help={s.configured ? `Definido em ${f.dateTime(s.updatedAt)} · ${expiry}. Escreva um novo para o substituir.` : 'Cole aqui o token da SAXO Bank.'}>
            {(p) => (
              <input {...p} className="input" type="password" name="saxo-token" autoComplete="off" spellCheck={false}
                value={token} onChange={(e) => setToken(e.target.value)} placeholder={s.configured ? '••••••••••••' : ''} />
            )}
          </Field>
          {s.expired && <Notice tone="warning">O token expirou ou foi recusado pela SAXO Bank: gere um novo no portal e guarde-o aqui.</Notice>}
          {!s.canEncrypt && <Notice tone="warning">A chave de cifra do servidor não está configurada: não é possível guardar o token.</Notice>}
          {result && <Notice tone={result.tone}>{result.text}</Notice>}
          <div className="row">
            <Button type="submit" variant="primary" busy={busy} disabled={!clean || !valid || !s.canEncrypt}>Guardar</Button>
            {s.configured && <Button onClick={test} busy={testing} disabled={busy}>Testar ligação</Button>}
            {s.configured && <Button variant="ghost" onClick={remove} disabled={busy}>Remover token</Button>}
          </div>
        </form>
      )}
    </section>
  );
}
