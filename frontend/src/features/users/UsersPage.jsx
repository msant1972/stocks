import { useState } from 'react';
import { Navigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { useMe } from '../../lib/queries.js';
import { ErrorState, Loading } from '../../components/feedback/states.jsx';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Button, Dialog, Field, Notice } from '../../components/ui/controls.jsx';
import Icon from '../../components/ui/Icon.jsx';

const MIN_PASSWORD = 10;

/** Palavra-passe aleatória de 16 caracteres, sem caracteres ambíguos. */
function generatePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** Campo de palavra-passe visível (o administrador tem de a comunicar) com botão para gerar. */
function PasswordField({ value, onChange, label = 'Palavra-passe' }) {
  const tooShort = value && value.length < MIN_PASSWORD;
  return (
    <Field label={label} help={`Pelo menos ${MIN_PASSWORD} caracteres. Comunique-a ao utilizador por um canal seguro.`}
      error={tooShort ? 'A palavra-passe é demasiado curta.' : null}>
      {(p) => (
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input {...p} className="input num" type="text" autoComplete="new-password" spellCheck={false}
            value={value} onChange={(e) => onChange(e.target.value)} />
          <Button onClick={() => onChange(generatePassword())}>Gerar</Button>
        </div>
      )}
    </Field>
  );
}

function CreateUserDialog({ open, onClose, onDone }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [capital, setCapital] = useState('10000');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function close() {
    setEmail(''); setName(''); setPassword(''); setIsAdmin(false); setCapital('10000'); setError(null); setBusy(false);
    onClose();
  }

  const capitalValue = capital.trim().replace(/\s/g, '').replace(',', '.');
  const capitalOk = /^\d{1,12}(\.\d{1,2})?$/.test(capitalValue) && Number(capitalValue) > 0;
  const valid = /\S+@\S+\.\S+/.test(email) && name.trim() && password.length >= MIN_PASSWORD && capitalOk;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/users', { email, name, password, isAdmin, initialCapital: capitalValue });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onDone(`Utilizador ${email.trim().toLowerCase()} criado`);
      close();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title="Adicionar utilizador">
      <form onSubmit={submit} className="stack" style={{ gap: '1rem' }} noValidate>
        <Field label="Email">{(p) => <input {...p} className="input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Nome">{(p) => <input {...p} className="input" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <PasswordField value={password} onChange={setPassword} />
        <Field label="Capital virtual inicial (EUR)" error={capital && !capitalOk ? 'Indique um valor positivo, ex.: 10000.' : null}>
          {(p) => <input {...p} className="input num" inputMode="decimal" value={capital} onChange={(e) => setCapital(e.target.value)} />}
        </Field>
        <label className="row" style={{ gap: '0.5rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} style={{ width: 18, height: 18 }} />
          Administrador (pode gerir utilizadores)
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="modal-actions">
          <Button onClick={close}>Cancelar</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!valid}>Criar utilizador</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function close() { setPassword(''); setError(null); setBusy(false); onClose(); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put(`/admin/users/${user.id}/password`, { password });
      onDone(`Palavra-passe de ${user.email} redefinida`);
      close();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open={user != null} onClose={close} title="Redefinir palavra-passe">
      {user && (
        <form onSubmit={submit} className="stack" style={{ gap: '1rem' }} noValidate>
          <p><strong>{user.name}</strong> <span className="muted">· {user.email}</span></p>
          <PasswordField value={password} onChange={setPassword} label="Nova palavra-passe" />
          <p className="small muted">As sessões abertas deste utilizador são terminadas; terá de entrar com a nova palavra-passe.</p>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="modal-actions">
            <Button onClick={close}>Cancelar</Button>
            <Button type="submit" variant="primary" busy={busy} disabled={password.length < MIN_PASSWORD}>Redefinir</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function DeleteUserDialog({ user, onClose, onDone }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function close() { setConfirm(''); setError(null); setBusy(false); onClose(); }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/admin/users/${user.id}`);
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onDone(`Utilizador ${user.email} removido`);
      close();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open={user != null} onClose={close} title="Remover utilizador?">
      {user && (
        <>
          <Notice tone="warning">
            Vai apagar <strong>{user.email}</strong> e todos os seus dados: carteira virtual, operações, lista de acompanhamento e alertas.
            Não é possível desfazer.
          </Notice>
          <Field label="Para confirmar, escreva o email do utilizador">
            {(p) => <input {...p} className="input" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="modal-actions">
            <Button onClick={close}>Cancelar</Button>
            <Button variant="danger" busy={busy} disabled={confirm.trim().toLowerCase() !== user.email} onClick={remove}>Remover</Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

export default function UsersPage() {
  const { data: me } = useMe();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get('/admin/users'), enabled: !!me?.user.isAdmin });

  if (me && !me.user.isAdmin) return <Navigate to="/" replace />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Utilizadores</h1>
          <p className="page-sub">Contas com acesso à aplicação. Cada utilizador tem a sua carteira virtual.</p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />Adicionar utilizador</Button>
      </div>

      <section className="card" aria-labelledby="users-title">
        <div className="card-head">
          <h2 id="users-title" className="card-title">Lista de utilizadores</h2>
          {users.data && <span className="small muted">{users.data.items.length} {users.data.items.length === 1 ? 'utilizador' : 'utilizadores'}</span>}
        </div>
        {users.isPending ? <Loading /> : users.error ? <ErrorState error={users.error} onRetry={users.refetch} /> : (
          <div className="table-wrap" tabIndex={0} aria-label="Tabela de utilizadores">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Utilizador</th>
                  <th scope="col">Perfil</th>
                  <th scope="col">Criado em</th>
                  <th scope="col">Última sessão</th>
                  <th scope="col"><span className="visually-hidden">Acções</span></th>
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((u) => {
                  const self = u.id === me.user.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.name}</strong>{self && <span className="muted"> (você)</span>}
                        <div className="small muted">{u.email}</div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <span className={`badge ${u.isAdmin ? 'badge-accent' : ''}`}>{u.isAdmin ? 'Administrador' : 'Utilizador'}</span>
                          {u.disabled && <span className="badge badge-warning">Desactivado</span>}
                        </div>
                      </td>
                      <td className="small" style={{ whiteSpace: 'nowrap' }}>{f.dateTime(u.createdAt)}</td>
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{u.lastSeenAt ? f.dateTime(u.lastSeenAt) : 'Nunca'}</td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        <Button size="small" variant="ghost" disabled={self} onClick={() => setResetting(u)}
                          title={self ? 'Altere a sua palavra-passe em Definições' : undefined}>
                          Redefinir palavra-passe<span className="visually-hidden"> de {u.email}</span>
                        </Button>
                        <Button size="small" variant="danger" className="button-ghost" disabled={self} onClick={() => setDeleting(u)}
                          title={self ? 'Não pode remover a sua própria conta' : undefined}>
                          Remover<span className="visually-hidden"> {u.email}</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CreateUserDialog open={adding} onClose={() => setAdding(false)} onDone={toast} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} onDone={toast} />
      <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} onDone={toast} />
    </>
  );
}
