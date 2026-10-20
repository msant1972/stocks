import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { keys, useMe } from '../../lib/queries.js';
import { Button, Dialog, Field, Notice } from '../../components/ui/controls.jsx';
import { CodeField, codeReady, RecoveryCodes } from '../auth/mfa.jsx';

/** Código da aplicação, com alternativa para um código de recuperação. */
function CodeWithFallback({ code, setCode, recovery, setRecovery }) {
  return (
    <>
      <CodeField key={recovery ? 'r' : 't'} value={code} onChange={setCode} recovery={recovery} />
      <div>
        <Button variant="ghost" size="small" onClick={() => { setRecovery((v) => !v); setCode(''); }}>
          {recovery ? 'Usar a aplicação' : 'Usar um código de recuperação'}
        </Button>
      </div>
    </>
  );
}

function RegenerateDialog({ open, onClose, email }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [codes, setCodes] = useState(null);

  function close() { setCode(''); setRecovery(false); setBusy(false); setError(null); setCodes(null); onClose(); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCodes((await api.post('/me/mfa/recovery-codes', { code })).recoveryCodes);
      qc.invalidateQueries({ queryKey: ['me-mfa'] });
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={codes ? 'Códigos de recuperação novos' : 'Gerar códigos de recuperação'}>
      {codes ? (
        <div className="stack" style={{ gap: '1rem' }}>
          <p className="small muted">Os códigos anteriores deixaram de funcionar. Guarde estes fora do telemóvel; só são mostrados agora.</p>
          <RecoveryCodes codes={codes} email={email} />
          <div className="modal-actions"><Button variant="primary" onClick={close}>Concluído</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="stack" style={{ gap: '1rem' }} noValidate>
          <p className="small muted">Os 10 códigos actuais deixam de funcionar e são criados 10 novos.</p>
          <CodeWithFallback code={code} setCode={setCode} recovery={recovery} setRecovery={setRecovery} />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="modal-actions">
            <Button onClick={close}>Cancelar</Button>
            <Button type="submit" variant="primary" busy={busy} disabled={!codeReady(code, recovery)}>Gerar códigos</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function ResetDialog({ open, onClose, email }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function close() { setPassword(''); setCode(''); setRecovery(false); setBusy(false); setError(null); onClose(); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api.post('/me/mfa/reset', { password, code });
      qc.clear();
      qc.setQueryData(keys.me, data); // sessão restrita: o ecrã de entrada mostra o QR code novo
      navigate('/entrar', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title="Trocar de aplicação de autenticação">
      <form onSubmit={submit} className="stack" style={{ gap: '1rem' }} noValidate>
        <p className="small muted">
          Para mudar de telemóvel ou de aplicação. Todas as sessões são terminadas e é mostrado um QR code novo; os códigos de
          recuperação actuais deixam de funcionar.
        </p>
        <input type="text" autoComplete="username" value={email} readOnly hidden />
        <Field label="Palavra-passe">
          {(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <CodeWithFallback code={code} setCode={setCode} recovery={recovery} setRecovery={setRecovery} />
        {error && <Notice tone="error">{error}</Notice>}
        <div className="modal-actions">
          <Button onClick={close}>Cancelar</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!password || !codeReady(code, recovery)}>Continuar</Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function MfaCard() {
  const { data: me } = useMe();
  const status = useQuery({ queryKey: ['me-mfa'], queryFn: () => api.get('/me/mfa') });
  const [dialog, setDialog] = useState(null);
  const left = status.data?.recoveryCodesLeft;

  return (
    <section className="card" aria-labelledby="mfa-title">
      <div className="card-head">
        <h2 id="mfa-title" className="card-title">Autenticação em dois passos</h2>
        <span className="badge badge-positive">Activa</span>
      </div>
      <p className="small muted" style={{ marginBottom: '1rem' }}>
        Ao entrar, além da palavra-passe é pedido o código da aplicação de autenticação.
        {status.data?.enabledAt && <> Activa desde {f.dateTime(status.data.enabledAt)}.</>}
      </p>
      {left != null && (
        left <= 3
          ? <Notice tone="warning">Restam {left} códigos de recuperação. Gere novos antes que se esgotem.</Notice>
          : <p className="small">Códigos de recuperação por usar: <strong>{left}</strong> de 10.</p>
      )}
      <div className="row" style={{ gap: 8, marginTop: '1rem' }}>
        <Button onClick={() => setDialog('regen')}>Gerar novos códigos de recuperação</Button>
        <Button variant="ghost" onClick={() => setDialog('reset')}>Trocar de aplicação</Button>
      </div>
      <RegenerateDialog open={dialog === 'regen'} onClose={() => setDialog(null)} email={me?.user.email ?? ''} />
      <ResetDialog open={dialog === 'reset'} onClose={() => setDialog(null)} email={me?.user.email ?? ''} />
    </section>
  );
}
