import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { formatBytes, staleBackupWarning } from '../../lib/backups.js';
import { ErrorState, Loading } from '../../components/feedback/states.jsx';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Button, Notice } from '../../components/ui/controls.jsx';
import Icon from '../../components/ui/Icon.jsx';

/**
 * Cópias de segurança da base de dados (administradores): lista as do servidor, cria uma agora (o mesmo script do timer
 * diário das 03:30 UTC) e descarrega qualquer uma. O restauro faz-se à mão no servidor (deploy/README.md): substitui a base
 * toda e não fica a um clique.
 */
export default function BackupCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['backups'], queryFn: () => api.get('/admin/backups'), refetchInterval: (query) => (query.state.data?.creating ? 3000 : false) });
  const create = useMutation({
    mutationFn: () => api.post('/admin/backups'),
    onSuccess: (b) => { toast(`Cópia criada: ${b.name} (${formatBytes(b.size)})`); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });
  const d = q.data;
  const warning = d ? staleBackupWarning(d.items) : null;

  return (
    <section className="card" aria-labelledby="backup-title">
      <div className="card-head">
        <h2 id="backup-title" className="card-title">Cópias de segurança</h2>
        <Button variant="primary" busy={create.isPending || d?.creating} onClick={() => create.mutate()}>
          <Icon name="download" size={18} />Criar cópia agora
        </Button>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Cópia diária da base de dados às 03:30 (UTC), guardada {d?.retentionDays ?? 30} dias no servidor. Uma cópia contém todos os dados,
        incluindo palavras-passe cifradas e segredos: guarde as que descarregar em local seguro. Fora do servidor, o fornecedor faz o autobackup do VPS.
      </p>
      {create.error && <Notice tone="error">{errorMessage(create.error)}</Notice>}
      {q.isPending ? <Loading rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <dl className="kpis" style={{ margin: '0.5rem 0 0.75rem' }}>
            <div><dt>Base de dados</dt><dd>{formatBytes(d.databaseBytes)}</dd></div>
            <div><dt>Cópias no servidor</dt><dd>{d.items.length}</dd></div>
            <div><dt>Última cópia</dt><dd>{d.items[0] ? f.dateTime(d.items[0].createdAt) : '—'}</dd></div>
          </dl>
          {warning && <Notice tone="warning">{warning}</Notice>}
          {d.items.length > 0 && (
            <div className="table-wrap" tabIndex={0} aria-label="Cópias de segurança no servidor" style={{ maxHeight: '18rem', overflowY: 'auto' }}>
              <table className="data">
                <thead>
                  <tr><th scope="col">Cópia</th><th scope="col" className="r">Tamanho</th><th scope="col"><span className="visually-hidden">Descarregar</span></th></tr>
                </thead>
                <tbody>
                  {d.items.map((b) => (
                    <tr key={b.name}>
                      <td><span className="num">{f.dateTime(b.createdAt)}</span><div className="small muted">{b.name}</div></td>
                      <td className="r num">{formatBytes(b.size)}</td>
                      <td className="r">
                        <a className="button button-small" href={`/api/v1/admin/backups/${b.name}`} download={b.name}>
                          <Icon name="download" size={16} />Descarregar<span className="visually-hidden"> {b.name}</span>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small muted" style={{ margin: '0.75rem 0 0' }}>
            Restaurar: não há botão (substitui a base de dados toda). Faz-se no servidor, com a API e os timers parados, como descrito em
            <code> deploy/README.md</code> (Cópias de segurança), de preferência primeiro numa base separada para conferir.
          </p>
        </>
      )}
    </section>
  );
}
