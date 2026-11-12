import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { useLogoConfig, useMe } from '../../lib/queries.js';
import { internalLogoUrl } from '../../lib/logo.js';
import { downloadLogo } from '../../lib/logoDownload.js';
import { ErrorState, Loading } from '../../components/feedback/states.jsx';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Button, Notice } from '../../components/ui/controls.jsx';

const STATES = {
  waiting: { label: 'À espera', tone: '' },
  working: { label: 'A descarregar…', tone: 'badge-accent' },
  ok: { label: 'Guardado', tone: 'badge-positive' },
  notFound: { label: 'Sem logotipo na Brandfetch', tone: 'badge-warning' },
  error: { label: 'Erro', tone: 'badge-negative' },
};
const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Administração → Logotipos: descarrega no browser, da Brandfetch Logo API, os logotipos em falta (10 de cada vez) e
 * envia-os para o servidor, que os guarda na base de dados. As páginas (Charts, HeatMap) mostram só os logotipos internos.
 */
export default function LogosPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const cfg = useLogoConfig();
  const summary = useQuery({ queryKey: ['logos-summary'], queryFn: () => api.get('/admin/logos/summary'), enabled: !!me?.user.isAdmin });
  const [retry, setRetry] = useState(false);
  const [batch, setBatch] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  if (me && !me.user.isAdmin) return <Navigate to="/" replace />;
  const clientId = cfg.data?.clientId;
  const s = summary.data;
  const pending = s ? s.missing + (retry ? s.notFound : 0) : 0;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const { items } = await api.get(`/admin/logos/missing${retry ? '?retry=true' : ''}`);
      const rows = items.map((i) => ({ ...i, state: 'waiting' }));
      setBatch(rows);
      const set = (id, patch) => setBatch((xs) => xs.map((x) => (x.instrumentId === id ? { ...x, ...patch } : x)));
      let saved = 0;
      for (const it of items) {
        set(it.instrumentId, { state: 'working' });
        try {
          const blob = await downloadLogo(it.domain, clientId);
          const form = new FormData();
          form.append('file', blob, 'logo.png');
          const { logoVersion } = await api.put(`/admin/instruments/${it.instrumentId}/logo`, form);
          set(it.instrumentId, { state: 'ok', logoVersion });
          saved += 1;
        } catch (err) {
          if (err.code === 'NOT_FOUND') {
            await api.post(`/admin/instruments/${it.instrumentId}/logo/not-found`).catch(() => {});
            set(it.instrumentId, { state: 'notFound' });
          } else {
            set(it.instrumentId, { state: 'error', message: errorMessage(err) });
          }
        }
        await pause(300); // sem pressa: não sobrecarregar a Brandfetch
      }
      toast(items.length ? `${saved} de ${items.length} logotipos guardados` : 'Não há logotipos em falta');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
      qc.invalidateQueries({ queryKey: ['logos-summary'] });
      qc.invalidateQueries({ queryKey: ['heatmap'] });
      qc.invalidateQueries({ queryKey: ['instrument'] });
    }
  }

  async function remove(row) {
    try {
      await api.del(`/admin/instruments/${row.instrumentId}/logo`);
      toast(`Logotipo de ${row.symbol} apagado`);
      qc.invalidateQueries({ queryKey: ['logos-summary'] });
    } catch (err) { setError(errorMessage(err)); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Logotipos</h1>
          <p className="page-sub">
            Logotipos das empresas guardados na aplicação e mostrados no Charts e no HeatMap. Os que faltam são descarregados neste
            browser da Brandfetch, {s?.batch ?? 10} de cada vez, a partir do site de cada empresa, e enviados para o servidor.
          </p>
        </div>
      </div>

      {cfg.data && !clientId && (
        <Notice tone="warning">Falta o Client ID da Brandfetch. <Link to="/definicoes">Abrir Definições → Logotipos</Link></Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <section className="card" aria-labelledby="logos-state">
        <h2 id="logos-state" className="card-title" style={{ marginBottom: '0.75rem' }}>Estado</h2>
        {summary.isPending ? <Loading rows={2} /> : summary.error ? <ErrorState error={summary.error} onRetry={summary.refetch} /> : (
          <>
            <dl className="kpis">
              <div><dt>Instrumentos activos</dt><dd>{f.number(s.active)}</dd></div>
              <div><dt>Com logotipo</dt><dd>{f.number(s.withLogo)}</dd></div>
              <div><dt>Em falta</dt><dd>{f.number(s.missing)}</dd></div>
              <div><dt>Sem logotipo na Brandfetch</dt><dd>{f.number(s.notFound)}</dd></div>
              <div><dt>Sem site (não se pode procurar)</dt><dd>{f.number(s.noWebsite)}</dd></div>
            </dl>
            <div className="row" style={{ marginTop: '1rem' }}>
              <Button variant="primary" busy={running} disabled={!clientId || running || pending === 0} onClick={run}>
                Descarregar os próximos {Math.min(s.batch, pending) || s.batch}
              </Button>
              <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={retry} disabled={running} onChange={(e) => setRetry(e.target.checked)} style={{ width: 18, height: 18 }} />
                Tentar de novo os que a Brandfetch não tinha
              </label>
            </div>
          </>
        )}
      </section>

      {batch.length > 0 && (
        <section className="card" aria-labelledby="logos-batch">
          <h2 id="logos-batch" className="card-title" style={{ marginBottom: '0.75rem' }}>Este lote</h2>
          <div className="table-wrap" tabIndex={0} aria-label="Logotipos deste lote">
            <table className="data">
              <thead><tr><th scope="col">Logotipo</th><th scope="col">Instrumento</th><th scope="col">Domínio</th><th scope="col">Estado</th></tr></thead>
              <tbody>
                {batch.map((r) => (
                  <tr key={r.instrumentId}>
                    <td>{r.logoVersion ? <img className="instrument-logo" src={internalLogoUrl(r.instrumentId, r.logoVersion)} alt="" width={32} height={32} /> : '—'}</td>
                    <td><strong>{r.symbol}</strong><div className="small muted">{r.name}</div></td>
                    <td className="small">{r.domain}</td>
                    <td><span className={`badge ${STATES[r.state].tone}`} title={r.message}>{STATES[r.state].label}</span>{r.message && <div className="small muted">{r.message}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {s?.recent.length > 0 && (
        <section className="card" aria-labelledby="logos-recent">
          <h2 id="logos-recent" className="card-title" style={{ marginBottom: '0.75rem' }}>Últimos registos</h2>
          <div className="table-wrap" tabIndex={0} aria-label="Últimos logotipos registados">
            <table className="data">
              <thead><tr><th scope="col">Logotipo</th><th scope="col">Instrumento</th><th scope="col">Estado</th><th scope="col">Quando</th><th scope="col"><span className="visually-hidden">Acções</span></th></tr></thead>
              <tbody>
                {s.recent.map((r) => (
                  <tr key={r.instrumentId}>
                    <td>{r.logoVersion ? <img className="instrument-logo" src={internalLogoUrl(r.instrumentId, r.logoVersion)} alt="" width={32} height={32} /> : '—'}</td>
                    <td><Link to={`/charts?instrumento=${r.instrumentId}`} className="row-link">{r.symbol}</Link><div className="small muted">{r.name}</div></td>
                    <td><span className={`badge ${r.status === 'ok' ? 'badge-positive' : 'badge-warning'}`}>{r.status === 'ok' ? 'Guardado' : 'Sem logotipo na Brandfetch'}</span></td>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{f.dateTime(r.updatedAt)}</td>
                    <td className="r">
                      <Button size="small" variant="ghost" onClick={() => remove(r)}>
                        {r.status === 'ok' ? 'Apagar' : 'Repor em falta'}<span className="visually-hidden"> {r.symbol}</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
