import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { Button, Field, Notice } from '../../components/ui/controls.jsx';

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SECRET_RE = /^[\x21-\x7e]{8,256}$/;

/**
 * Ligação à SAXO Bank (conta de simulação). Chave e segredo da aplicação SAXO (criada no portal, grant type «Code») ficam
 * guardados no servidor, o segredo cifrado e nunca mostrado de novo. «Ligar à SAXO» leva ao login da SAXO e volta com a
 * autorização; a partir daí os tokens renovam-se sozinhos.
 */
export default function SaxoCard() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['integration-saxo'], queryFn: () => api.get('/me/integrations/saxo') });
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(null); // 'app' | 'connect' | 'test' | 'disconnect'
  const [result, setResult] = useState(null); // { tone, text }
  const s = q.data;

  // Retorno da SAXO: /definicoes?saxo=ok|erro&motivo=…
  useEffect(() => {
    const r = params.get('saxo');
    if (!r) return;
    setResult(r === 'ok'
      ? { tone: 'info', text: 'Ligado à SAXO Bank. Use «Testar ligação» para confirmar.' }
      : { tone: 'error', text: `Não foi possível ligar à SAXO Bank: ${params.get('motivo') || 'erro desconhecido'}.` });
    qc.invalidateQueries({ queryKey: ['integration-saxo'] });
    setParams((p) => { const n = new URLSearchParams(p); n.delete('saxo'); n.delete('motivo'); return n; }, { replace: true });
  }, [params, setParams, qc]);

  useEffect(() => { if (s?.app && !appKey) setAppKey(s.app.appKey); }, [s?.app, appKey]);

  const key = appKey.trim();
  const secret = appSecret.trim();
  const keyOk = KEY_RE.test(key);
  const secretOk = SECRET_RE.test(secret);
  const sameApp = Boolean(s?.app && s.app.appKey === key);
  const canSaveApp = keyOk && (secretOk || (sameApp && !secret));

  async function run(name, fn) {
    setBusy(name);
    setResult(null);
    try {
      await fn();
    } catch (err) {
      setResult({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const saveApp = (e) => { e.preventDefault(); return run('app', async () => {
    qc.setQueryData(['integration-saxo'], await api.put('/me/integrations/saxo/app', { appKey: key, ...(secret ? { appSecret: secret } : {}) }));
    setAppSecret('');
    setResult({ tone: 'info', text: 'Aplicação guardada (o segredo fica cifrado no servidor). Já pode ligar à SAXO.' });
  }); };

  const connect = () => run('connect', async () => {
    const { url } = await api.post('/me/integrations/saxo/connect');
    window.location.assign(url);
    await new Promise(() => {}); // a página vai ser substituída
  });

  const test = () => run('test', async () => {
    try {
      const c = await api.get('/saxo/connection');
      setResult({ tone: 'info', text: `Ligação OK: conta ${c.accountId}${c.isTrial ? ' (simulação)' : ''}, saldo ${c.cashBalance == null ? '—' : f.money(c.cashBalance, c.currency)}.` });
    } finally {
      qc.invalidateQueries({ queryKey: ['integration-saxo'] }); // um 401 marca a ligação como expirada
    }
  });

  const disconnect = () => run('disconnect', async () => {
    await api.del('/me/integrations/saxo');
    await qc.invalidateQueries({ queryKey: ['integration-saxo'] });
    setResult({ tone: 'info', text: 'Desligado da SAXO Bank. A aplicação continua guardada.' });
  });

  const removeApp = () => run('app', async () => {
    await api.del('/me/integrations/saxo/app');
    setAppKey(''); setAppSecret('');
    await qc.invalidateQueries({ queryKey: ['integration-saxo'] });
    setResult({ tone: 'info', text: 'Aplicação removida.' });
  });


  return (
    <section className="card" aria-labelledby="saxo-title">
      <div className="spread">
        <h2 id="saxo-title" className="card-title">SAXO Bank</h2>
        <span className="badge badge-warning">Simulação (SIM)</span>
      </div>
      <p className="small muted" style={{ margin: '0.25rem 0 1rem' }}>
        Ligação à conta de simulação da SAXO Bank para enviar ordens, sempre com uma pré-validação e uma confirmação; a conta real
        não está activada. Crie uma aplicação no portal de programadores da SAXO (grant type «Code») e guarde aqui a chave e o
        segredo: o segredo fica cifrado no servidor e nunca é mostrado de novo. As ordens da aplicação vão para esta conta de simulação.
      </p>
      {q.isPending ? <p className="small muted">A carregar…</p> : q.error ? <Notice tone="error">{errorMessage(q.error)}</Notice> : (
        <div className="stack" style={{ gap: '1.25rem', maxWidth: '36rem' }}>
          <form className="stack" style={{ gap: '1rem' }} noValidate onSubmit={saveApp}>
            <Field label="App Key (chave da aplicação)" error={key && !keyOk ? 'Indique a chave tal como está no portal da SAXO.' : null}>
              {(p) => <input {...p} className="input" name="saxo-app-key" autoComplete="off" spellCheck={false} value={appKey} onChange={(e) => setAppKey(e.target.value)} />}
            </Field>
            <Field label="App Secret (segredo da aplicação)" error={secret && !secretOk ? 'O segredo não pode ter espaços nem caracteres especiais.' : null}
              help={s.app?.hasSecret ? 'Já guardado. Escreva um novo só para o substituir.' : 'Cole aqui o segredo da aplicação.'}>
              {(p) => <input {...p} className="input" type="password" name="saxo-app-secret" autoComplete="off" spellCheck={false}
                value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder={s.app?.hasSecret ? '••••••••••••' : ''} />}
            </Field>
            {s.redirectUri ? (
              <p className="small muted">URL de retorno a registar na aplicação SAXO: <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{s.redirectUri}</code></p>
            ) : <Notice tone="warning">A origem pública do servidor não está configurada (STOCKS_PUBLIC_ORIGIN): não é possível ligar por OAuth.</Notice>}
            {!s.canEncrypt && <Notice tone="warning">A chave de cifra do servidor não está configurada: não é possível guardar o segredo.</Notice>}
            <div className="row">
              <Button type="submit" variant="primary" busy={busy === 'app'} disabled={!canSaveApp || !s.canEncrypt || Boolean(busy)}>Guardar aplicação</Button>
              {s.app && <Button variant="ghost" onClick={removeApp} disabled={Boolean(busy)}>Remover aplicação</Button>}
            </div>
          </form>

          <div className="stack" style={{ gap: '0.75rem' }}>
            <p className="small">
              <strong>Ligação:</strong>{' '}
              {!s.configured ? 'não ligado.'
                : s.expired ? 'a ligação expirou ou foi recusada pela SAXO: volte a ligar.'
                : `ligado, com renovação automática (desde ${f.dateTime(s.updatedAt)}).`}
            </p>
            {result && <Notice tone={result.tone}>{result.text}</Notice>}
            <div className="row">
              <Button variant="primary" onClick={connect} busy={busy === 'connect'} disabled={!s.app || !s.canConnect || Boolean(busy)}
                title={s.app ? undefined : 'Guarde primeiro a chave e o segredo da aplicação'}>
                {s.configured ? 'Voltar a ligar à SAXO' : 'Ligar à SAXO'}
              </Button>
              {s.configured && <Button onClick={test} busy={busy === 'test'} disabled={Boolean(busy)}>Testar ligação</Button>}
              {s.configured && <Button variant="ghost" onClick={disconnect} disabled={Boolean(busy)}>Desligar</Button>}
            </div>
          </div>

        </div>
      )}
    </section>
  );
}
