import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { Button, Field, Notice } from '../../components/ui/controls.jsx';

const SECURITY = [
  { value: 'starttls', label: 'STARTTLS', port: 587 },
  { value: 'ssl', label: 'SSL/TLS', port: 465 },
  { value: 'none', label: 'Sem cifra', port: 25 },
];

/** Configuração SMTP usada pelo motor de alertas (só administradores). */
export default function SmtpCard({ adminEmail }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-smtp'], queryFn: () => api.get('/admin/smtp') });
  const [form, setForm] = useState({ host: '', port: '587', security: 'starttls', username: '', sender: '' });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // { tone, text }

  useEffect(() => {
    const s = q.data;
    if (s?.configured) {
      setForm({ host: s.host, port: String(s.port), security: s.security, username: s.username ?? '', sender: s.sender });
    }
  }, [q.data]);

  const set = (k) => (e) => setForm((cur) => ({ ...cur, [k]: e.target.value }));
  function setSecurity(e) {
    const value = e.target.value;
    // Ajusta a porta à cifra escolhida, se ainda estiver numa porta típica.
    setForm((cur) => ({
      ...cur, security: value,
      port: SECURITY.some((s) => String(s.port) === cur.port) ? String(SECURITY.find((s) => s.value === value).port) : cur.port,
    }));
  }

  const portOk = /^\d+$/.test(form.port) && Number(form.port) >= 1 && Number(form.port) <= 65535;
  const valid = form.host.trim() && portOk && /\S+@\S+\.\S+/.test(form.sender);

  async function save(payloadPassword) {
    setBusy(true);
    setResult(null);
    try {
      const body = { ...form, port: Number(form.port) };
      if (payloadPassword !== undefined) body.password = payloadPassword;
      const data = await api.put('/admin/smtp', body);
      qc.setQueryData(['admin-smtp'], data);
      setPassword('');
      setResult({ tone: 'info', text: 'Configuração guardada. Os próximos alertas usam estes dados.' });
    } catch (err) {
      setResult({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setResult(null);
    try {
      const r = await api.post('/admin/smtp/test');
      setResult({ tone: r.ok ? 'info' : 'error', text: r.ok ? `Email de teste enviado para ${adminEmail}.` : `Falha no envio: ${r.message}` });
    } catch (err) {
      setResult({ tone: 'error', text: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  }

  const s = q.data;
  return (
    <section className="card" aria-labelledby="smtp-title">
      <h2 id="smtp-title" className="card-title">Envio de email (SMTP)</h2>
      <p className="small muted" style={{ margin: '0.25rem 0 1rem' }}>
        Usado pelo motor de alertas para enviar os resumos diários.
        {s?.configured ? ` Última alteração: ${f.dateTime(s.updatedAt)}${s.updatedBy ? ` por ${s.updatedBy}` : ''}.` : ' Sem configuração, os alertas são avaliados mas nenhum email é enviado.'}
      </p>
      {q.isPending ? <p className="small muted">A carregar…</p> : (
        <form className="stack" style={{ gap: '1rem', maxWidth: '36rem' }} noValidate
          onSubmit={(e) => { e.preventDefault(); save(password ? password : undefined); }}>
          <div className="filters" style={{ marginBottom: 0 }}>
            <Field label="Servidor SMTP">{(p) => <input {...p} className="input" placeholder="smtp.exemplo.pt" autoComplete="off" value={form.host} onChange={set('host')} />}</Field>
            <Field label="Segurança (TLS)">
              {(p) => (
                <select {...p} className="select" value={form.security} onChange={setSecurity}>
                  {SECURITY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </Field>
            <Field label="Porta" error={form.port && !portOk ? 'Porta entre 1 e 65535.' : null}>
              {(p) => <input {...p} className="input num" inputMode="numeric" value={form.port} onChange={set('port')} />}
            </Field>
          </div>
          <div className="filters" style={{ marginBottom: 0 }}>
            <Field label="Utilizador (username)">{(p) => <input {...p} className="input" autoComplete="off" value={form.username} onChange={set('username')} />}</Field>
            <Field label="Palavra-passe SMTP" help={s?.passwordSet ? 'Definida. Deixe vazio para manter.' : 'Opcional, se o servidor não exigir autenticação.'}>
              {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={s?.passwordSet ? '••••••••' : ''} />}
            </Field>
          </div>
          <Field label="Remetente (from)" help="Ex.: Stocks <alertas@graus.pt>. Com domínio próprio, configure SPF e DKIM para os emails não irem para spam.">
            {(p) => <input {...p} className="input" autoComplete="off" value={form.sender} onChange={set('sender')} />}
          </Field>
          {s && !s.canEncrypt && <Notice tone="warning">A chave de cifra do servidor não está configurada: não é possível guardar palavras-passe.</Notice>}
          {result && <Notice tone={result.tone}>{result.text}</Notice>}
          <div className="row">
            <Button type="submit" variant="primary" busy={busy} disabled={!valid}>Guardar</Button>
            <Button onClick={sendTest} busy={testing} disabled={!s?.configured || !s?.canTest}
              title={s?.canTest ? `Envia um email para ${adminEmail}` : 'Indisponível neste servidor'}>
              {testing ? 'A enviar…' : 'Enviar email de teste'}
            </Button>
            {s?.passwordSet && (
              <Button variant="ghost" onClick={() => save('')} disabled={busy}>Remover palavra-passe</Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
