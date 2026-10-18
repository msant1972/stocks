import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { useMe, useStatus } from '../../lib/queries.js';
import { useReducedTransparency, useTheme } from '../../lib/theme.js';
import { Button, Field, Notice, Segmented, Switch } from '../../components/ui/controls.jsx';

function PasswordForm() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { data: me } = useMe();
  const tooShort = next && next.length < 10;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put('/me/password', { currentPassword: current, newPassword: next });
      qc.clear();
      navigate('/entrar', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: '1rem', maxWidth: '26rem' }} noValidate>
      <input type="text" autoComplete="username" value={me?.user.email ?? ''} readOnly hidden />
      <Field label="Palavra-passe actual">
        {(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
      </Field>
      <Field label="Nova palavra-passe" help="Pelo menos 10 caracteres." error={tooShort ? 'A palavra-passe é demasiado curta.' : null}>
        {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <p className="small muted">Ao alterar a palavra-passe, todas as sessões são terminadas e terá de entrar de novo.</p>
      <div><Button type="submit" busy={busy} disabled={!current || !next || tooShort}>Alterar palavra-passe</Button></div>
    </form>
  );
}

export default function SettingsPage() {
  const [theme, setTheme] = useTheme();
  const [reduced, setReduced] = useReducedTransparency();
  const { data: me } = useMe();
  const { data: status } = useStatus();

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Definições</h1>
          <p className="page-sub">{me?.user.name} · {me?.user.email}</p>
        </div>
      </div>
      <div className="stack">
        <section className="card" aria-labelledby="look-title">
          <h2 id="look-title" className="card-title" style={{ marginBottom: '1rem' }}>Aparência</h2>
          <div className="stack" style={{ gap: '1rem' }}>
            <Segmented label="Tema" value={theme} onChange={setTheme}
              options={[{ value: 'light', label: 'Claro' }, { value: 'dark', label: 'Escuro' }, { value: 'system', label: 'Sistema' }]} />
            <div className="row">
              <Switch checked={reduced} onChange={setReduced} label="Reduzir transparência" />
              <span>Reduzir transparência</span>
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="rules-title">
          <h2 id="rules-title" className="card-title" style={{ marginBottom: '0.75rem' }}>Regras da simulação</h2>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }} className="stack small">
            <li>As operações são virtuais: não há dinheiro real nem ligação a corretoras.</li>
            <li>Cada operação usa o último fecho diário disponível (não ajustado) e regista a data dessa cotação.</li>
            <li>Uma compra não pode exceder o saldo virtual; uma venda não pode exceder a quantidade detida. Não há vendas a descoberto.</li>
            <li>Quantidades inteiras, sem comissões. O custo das posições é o custo médio ponderado.</li>
            <li>Só são simuláveis instrumentos cotados em EUR. Com cotações com mais de 7 dias, as operações são recusadas.</li>
            <li>Os gráficos usam o fecho ajustado (dividendos e desdobramentos); dividendos e desdobramentos não alteram as posições.</li>
          </ul>
        </section>

        <section className="card" aria-labelledby="data-title">
          <h2 id="data-title" className="card-title" style={{ marginBottom: '0.75rem' }}>Dados</h2>
          {status ? (
            <dl className="summary-box" style={{ maxWidth: '32rem' }}>
              <dt>Última sessão recolhida</dt><dd>{f.date(status.latestSession)}</dd>
              <dt>Última actualização diária</dt><dd>{status.lastFetchRun ? f.dateTime(status.lastFetchRun.finishedAt ?? status.lastFetchRun.startedAt) : '—'}</dd>
              <dt>Instrumentos activos</dt><dd>{status.instruments.active}</dd>
              <dt>A validar</dt><dd>{status.instruments.pending}</dd>
              <dt>Inválidos</dt><dd>{status.instruments.invalid}</dd>
            </dl>
          ) : <p className="small muted">A carregar…</p>}
          <p className="small muted" style={{ marginTop: '0.75rem' }}>
            Fonte: Yahoo Finance, recolhido diariamente nos dias úteis às 19h00 (Lisboa). Os dados podem ter atrasos ou falhas do fornecedor.
          </p>
        </section>

        <section className="card" aria-labelledby="pw-title">
          <h2 id="pw-title" className="card-title" style={{ marginBottom: '1rem' }}>Palavra-passe</h2>
          <PasswordForm />
        </section>
      </div>
    </>
  );
}
