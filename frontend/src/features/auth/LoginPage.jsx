import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import { keys, useMe } from '../../lib/queries.js';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Loading, ErrorState } from '../../components/feedback/states.jsx';
import { Button, Field, Notice } from '../../components/ui/controls.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { CodeField, codeReady, RecoveryCodes } from './mfa.jsx';

function Card({ title, sub, children }) {
  return (
    <div className="login-wrap">
      <main className="card login-card">
        <div className="brand" style={{ padding: '0 0 1rem' }}>
          <span className="brand-mark"><Icon name="trend" size={18} /></span>Stocks
        </div>
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>{title}</h1>
        {sub && <p className="page-sub" style={{ marginBottom: '1.5rem' }}>{sub}</p>}
        {children}
      </main>
    </div>
  );
}

/** Volta ao 1.º passo, terminando a sessão restrita. */
function useCancel() {
  const qc = useQueryClient();
  return async () => {
    await api.post('/auth/logout').catch(() => {});
    qc.setQueryData(keys.me, null);
  };
}

function PasswordStep({ onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onDone(await api.post('/auth/login', { email, password }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card title="Entrar" sub="Acompanha o mercado. Aprende com uma carteira virtual.">
      <form onSubmit={submit} className="stack" style={{ gap: '1rem' }} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Email">
          {(p) => <input {...p} className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Palavra-passe">
          {(p) => (
            <div style={{ position: 'relative' }}>
              <input {...p} className="input" type={show ? 'text' : 'password'} autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: '6.5rem' }} />
              <button type="button" className="button button-ghost button-small" onClick={() => setShow((v) => !v)}
                aria-pressed={show} style={{ position: 'absolute', right: 4, top: 4 }}>
                {show ? 'Ocultar' : 'Mostrar'}<span className="visually-hidden"> palavra-passe</span>
              </button>
            </div>
          )}
        </Field>
        <Button type="submit" variant="primary" busy={busy}>{busy ? 'A entrar…' : 'Entrar'}</Button>
      </form>
      <p className="small muted" style={{ marginTop: '1.5rem' }}>
        Aplicação de simulação: não há operações com dinheiro real. As contas são criadas pelo administrador.
      </p>
    </Card>
  );
}

function VerifyStep({ email, onDone }) {
  const toast = useToast();
  const cancel = useCancel();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api.post('/auth/mfa/verify', { code });
      if (data.recoveryCodesLeft != null) {
        toast(`Código de recuperação usado. Restam ${data.recoveryCodesLeft}; pode gerar novos em Definições.`);
      }
      onDone(data);
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      setBusy(false);
    }
  }

  return (
    <Card title="Autenticação em dois passos"
      sub={recovery ? 'Introduza um dos códigos de recuperação que guardou ao activar.' : 'Introduza o código da aplicação de autenticação.'}>
      <form onSubmit={submit} className="stack" style={{ gap: '1rem' }} noValidate>
        <p className="small muted">{email}</p>
        {error && <Notice tone="error">{error}</Notice>}
        <CodeField key={recovery ? 'r' : 't'} value={code} onChange={setCode} recovery={recovery} />
        <Button type="submit" variant="primary" busy={busy} disabled={!codeReady(code, recovery)}>{busy ? 'A verificar…' : 'Verificar'}</Button>
        <div className="spread">
          <Button variant="ghost" size="small" onClick={() => { setRecovery((v) => !v); setCode(''); setError(null); }}>
            {recovery ? 'Usar a aplicação' : 'Usar um código de recuperação'}
          </Button>
          <Button variant="ghost" size="small" onClick={cancel}>Cancelar</Button>
        </div>
      </form>
      <p className="small muted" style={{ marginTop: '1.5rem' }}>
        Sem a aplicação nem os códigos de recuperação, peça ao administrador que reponha a autenticação em dois passos.
      </p>
    </Card>
  );
}

/** Formata o segredo base32 em grupos de 4 para ser escrito à mão. */
const groupSecret = (s) => s.replace(/(.{4})/g, '$1 ').trim();

function SetupStep({ email, onDone }) {
  const cancel = useCancel();
  // useQuery (e não useEffect) para que o segredo seja gerado uma única vez, mesmo em StrictMode.
  const setup = useQuery({ queryKey: ['mfa-setup'], queryFn: () => api.post('/auth/mfa/setup'), staleTime: Infinity, gcTime: 0, retry: false });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setResult(await api.post('/auth/mfa/enable', { code }));
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Card title="Guarde os códigos de recuperação"
        sub="Se perder o telemóvel, cada um destes códigos substitui uma vez o código da aplicação. Só são mostrados agora.">
        <div className="stack" style={{ gap: '1rem' }}>
          <RecoveryCodes codes={result.recoveryCodes} email={email} />
          <Notice tone="warning">Guarde-os num gestor de palavras-passe ou em papel, fora do telemóvel.</Notice>
          <label className="row" style={{ gap: '0.5rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} style={{ width: 18, height: 18 }} />
            Guardei os códigos de recuperação
          </label>
          <Button variant="primary" disabled={!saved} onClick={() => onDone(result)}>Continuar</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Activar autenticação em dois passos"
      sub="Para proteger a conta, além da palavra-passe passa a ser pedido um código do telemóvel.">
      {setup.isPending ? <Loading rows={4} label="A gerar o QR code…" /> : setup.error ? <ErrorState error={setup.error} onRetry={setup.refetch} /> : (
        <form onSubmit={submit} className="stack" style={{ gap: '1rem' }} noValidate>
          <ol className="mfa-steps small">
            <li>Instale uma aplicação de autenticação (Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden…).</li>
            <li>Leia o QR code com a aplicação.</li>
          </ol>
          <img className="mfa-qr" src={setup.data.qrCode} width={192} height={192} alt={`QR code para configurar a aplicação de autenticação para ${email}`} />
          <details className="small">
            <summary>Não consegue ler o QR code?</summary>
            <p className="muted" style={{ margin: '0.5rem 0 0.25rem' }}>Na aplicação, escolha introduzir uma chave e escreva:</p>
            <code className="mfa-secret num">{groupSecret(setup.data.secret)}</code>
            <p className="muted" style={{ marginTop: '0.25rem' }}>Conta: {email} · Tipo: baseado no tempo</p>
          </details>
          <ol className="mfa-steps small" start={3}><li>Introduza o código que a aplicação mostra.</li></ol>
          {error && <Notice tone="error">{error}</Notice>}
          <CodeField value={code} onChange={setCode} autoFocus={false} />
          <Button type="submit" variant="primary" busy={busy} disabled={!codeReady(code, false)}>{busy ? 'A activar…' : 'Activar'}</Button>
          <div><Button variant="ghost" size="small" onClick={cancel}>Cancelar e sair</Button></div>
        </form>
      )}
    </Card>
  );
}

export default function LoginPage() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from ?? '/';

  const pending = me.data?.mfa.pending;
  if (me.data && !pending) return <Navigate to={from} replace />;

  const store = (data) => qc.setQueryData(keys.me, { user: data.user, mfa: data.mfa });
  const finish = (data) => {
    store(data);
    navigate(from, { replace: true });
  };

  if (pending === 'verify') return <VerifyStep email={me.data.user.email} onDone={finish} />;
  if (pending === 'setup') return <SetupStep email={me.data.user.email} onDone={finish} />;
  return <PasswordStep onDone={store} />;
}
