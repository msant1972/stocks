import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import { keys, useMe } from '../../lib/queries.js';
import { Button, Field, Notice } from '../../components/ui/controls.jsx';
import Icon from '../../components/ui/Icon.jsx';

export default function LoginPage() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (me.data) return <Navigate to={location.state?.from ?? '/'} replace />;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api.post('/auth/login', { email, password });
      qc.setQueryData(keys.me, data);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <main className="card login-card">
        <div className="brand" style={{ padding: '0 0 1rem' }}>
          <span className="brand-mark"><Icon name="trend" size={18} /></span>Stocks
        </div>
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>Entrar</h1>
        <p className="page-sub" style={{ marginBottom: '1.5rem' }}>Acompanha o mercado. Aprende com uma carteira virtual.</p>
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
      </main>
    </div>
  );
}
