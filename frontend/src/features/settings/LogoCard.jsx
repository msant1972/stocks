import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { useLogoConfig } from '../../lib/queries.js';
import { logoUrl } from '../../lib/logo.js';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Button, Field, Notice } from '../../components/ui/controls.jsx';

const SAMPLE = 'asml.com';
// As chaves da Brand API (secretas) são longas; o Client ID da Logo API é curto.
const looksLikeSecret = (v) => v.length > 64;

/**
 * Logotipos (administradores): Client ID da Brandfetch Logo API. Os logotipos aparecem no cartão «Empresa» do Charts e no
 * HeatMap; o browser pede-os directamente ao CDN da Brandfetch (as imagens não são guardadas, como a Brandfetch exige).
 */
export default function LogoCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const cfg = useLogoConfig();
  const [value, setValue] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  const done = (msg) => (data) => { qc.setQueryData(['logos-config'], data); setValue(''); setPreviewFailed(false); toast(msg); };
  const save = useMutation({ mutationFn: (clientId) => api.put('/admin/logos', { clientId }), onSuccess: done('Client ID da Brandfetch guardado') });
  const remove = useMutation({ mutationFn: () => api.del('/admin/logos'), onSuccess: done('Client ID da Brandfetch apagado') });
  const current = cfg.data?.clientId;
  const v = value.trim();
  const secret = looksLikeSecret(v);
  const error = save.error ?? remove.error;
  const sample = logoUrl(SAMPLE, current, 32);

  return (
    <section className="card" aria-labelledby="logos-title">
      <h2 id="logos-title" className="card-title" style={{ marginBottom: '0.5rem' }}>Logotipos</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Logotipos das empresas da <a href="https://brandfetch.com/developers" target="_blank" rel="noopener noreferrer">Brandfetch Logo API</a>, no
        cartão «Empresa» do Charts e no HeatMap, a partir do site de cada empresa. O browser pede cada imagem ao CDN da Brandfetch
        (cdn.brandfetch.io), com o domínio da empresa; as imagens não são guardadas na aplicação, como a Brandfetch exige.
      </p>
      {cfg.data && (
        <p className="row small" style={{ gap: 8 }}>
          {current
            ? <>
                <span className="badge badge-positive">Configurado</span>
                {sample && !previewFailed && <img className="instrument-logo" src={sample} alt="Logotipo de exemplo (ASML)" width={32} height={32}
                  referrerPolicy="strict-origin-when-cross-origin" onError={() => setPreviewFailed(true)} />}
                {previewFailed && <span className="badge badge-warning" title="Confirme o Client ID e o domínio autorizado no portal da Brandfetch">Exemplo não carregou</span>}
                <span className="muted">{cfg.data.updatedBy ? `${cfg.data.updatedBy}, ` : ''}{cfg.data.updatedAt ? f.dateTime(cfg.data.updatedAt) : ''}</span>
              </>
            : <span className="badge">Sem Client ID: sem logotipos</span>}
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
