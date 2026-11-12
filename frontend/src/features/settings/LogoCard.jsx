import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { useLogoConfig } from '../../lib/queries.js';
import { logoUrl } from '../../lib/logo.js';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Button, Field, Notice, Switch } from '../../components/ui/controls.jsx';

const SAMPLE = 'asml.com';
// As chaves da Brand API (secretas) são longas; o Client ID da Logo API é curto.
const looksLikeSecret = (v) => v.length > 64;

/**
 * Logotipos (administradores): interruptor global e Client ID da Brandfetch Logo API, usado pelo módulo Administração →
 * Logotipos para descarregar os que faltam. As páginas mostram os logotipos guardados na aplicação.
 */
export default function LogoCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const cfg = useLogoConfig();
  const [value, setValue] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  const done = (msg) => (data) => { qc.setQueryData(['logos-config'], data); setValue(''); setPreviewFailed(false); toast(msg); };
  const save = useMutation({ mutationFn: (clientId) => api.put('/admin/logos', { clientId }), onSuccess: done('Client ID da Brandfetch guardado') });
  const toggle = useMutation({
    mutationFn: (enabled) => api.put('/admin/logos/enabled', { enabled }),
    onSuccess: (data) => { qc.setQueryData(['logos-config'], data); toast(data.enabled ? 'Logotipos ligados' : 'Logotipos desligados'); },
  });
  const remove = useMutation({ mutationFn: () => api.del('/admin/logos'), onSuccess: done('Client ID da Brandfetch apagado') });
  const current = cfg.data?.clientId;
  const v = value.trim();
  const secret = looksLikeSecret(v);
  const error = save.error ?? remove.error ?? toggle.error;
  const enabled = cfg.data?.enabled !== false;
  const sample = logoUrl(SAMPLE, current, 32);

  return (
    <section className="card" aria-labelledby="logos-title">
      <h2 id="logos-title" className="card-title" style={{ marginBottom: '0.5rem' }}>Logotipos</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Logotipos das empresas no Charts (cabeçalho e cartão «Empresa») e no HeatMap, guardados na aplicação. Os que faltam
        descarregam-se no módulo <Link to="/logotipos">Logotipos</Link> a partir da{' '}
        <a href="https://brandfetch.com/developers" target="_blank" rel="noopener noreferrer">Brandfetch Logo API</a>, com o Client ID abaixo.
      </p>
      {cfg.data && (
        <div className="row" style={{ gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Switch label="Mostrar logotipos" checked={enabled} disabled={toggle.isPending} onChange={(v) => toggle.mutate(v)} />
          <span aria-hidden="true">Mostrar logotipos em todas as páginas</span>
        </div>
      )}
      {cfg.data && (
        <p className="row small" style={{ gap: 8 }}>
          {current
            ? <>
                <span className="badge badge-positive">Configurado</span>
                {!enabled && <span className="badge badge-warning">Desligados</span>}
                {sample && !previewFailed && <img className="instrument-logo" src={sample} alt="Logotipo de exemplo (ASML)" width={32} height={32}
                  referrerPolicy="strict-origin-when-cross-origin" onError={() => setPreviewFailed(true)} />}
                {previewFailed && <span className="badge badge-warning" title="Confirme o Client ID e o domínio autorizado no portal da Brandfetch">Exemplo não carregou</span>}
                <span className="muted">{cfg.data.updatedBy ? `${cfg.data.updatedBy}, ` : ''}{cfg.data.updatedAt ? f.dateTime(cfg.data.updatedAt) : ''}</span>
              </>
            : <span className="badge">Sem Client ID: não se podem descarregar logotipos</span>}
        </p>
      )}
      <form className="stack" style={{ gap: '0.75rem', maxWidth: '30rem' }} noValidate
        onSubmit={(e) => { e.preventDefault(); if (v && !secret) save.mutate(v); }}>
        <Field label={current ? 'Novo Client ID' : 'Client ID'}
          help="No portal de programadores da Brandfetch, secção Logo API. Não é a API key da Brand API (essa é secreta e muito mais longa)."
          error={secret ? 'Isto parece a API key secreta da Brand API. A Logo API usa o Client ID, que é curto.' : null}>
          {(p) => <input {...p} className="input num" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} />}
        </Field>
        {error && <Notice tone="error">{errorMessage(error)}</Notice>}
        <div className="row">
          <Button type="submit" variant="primary" busy={save.isPending} disabled={!v || secret}>Guardar</Button>
          {current && <Button variant="danger" className="button-ghost" busy={remove.isPending} onClick={() => remove.mutate()}>Apagar</Button>}
        </div>
      </form>
    </section>
  );
}
