import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { countByStatus, experimentPayload, filterExperiments, LAB_ORDER, LAB_STATUS } from '../../lib/lab.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Button, Dialog, Field, Notice, Segmented } from '../../components/ui/controls.jsx';
import Icon from '../../components/ui/Icon.jsx';

const EMPTY = { title: '', status: 'idea', hypothesis: '', metric: '', result: '', startedOn: '', decidedOn: '' };
const today = () => new Date().toISOString().slice(0, 10);

/** Formulário de uma experiência (nova ou existente). */
function ExperimentDialog({ experiment, onClose }) {
  const qc = useQueryClient();
  const isNew = !experiment?.id;
  const [form, setForm] = useState(() => (isNew ? { ...EMPTY, startedOn: '' } : {
    title: experiment.title, status: experiment.status, hypothesis: experiment.hypothesis ?? '', metric: experiment.metric ?? '',
    result: experiment.result ?? '', startedOn: experiment.startedOn ?? '', decidedOn: experiment.decidedOn ?? '',
  }));
  const set = (k) => (e) => setForm((cur) => {
    const next = { ...cur, [k]: e.target.value };
    // Datas preenchidas ao mudar o estado: começou ao passar a «a decorrer»; decidida ao manter ou abandonar.
    if (k === 'status' && next.status === 'running' && !next.startedOn) next.startedOn = today();
    if (k === 'status' && ['kept', 'dropped'].includes(next.status) && !next.decidedOn) next.decidedOn = today();
    return next;
  });
  const save = useMutation({
    mutationFn: () => (isNew ? api.post('/experiments', experimentPayload(form)) : api.patch(`/experiments/${experiment.id}`, experimentPayload(form))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['experiments'] }); onClose(); },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/experiments/${experiment.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['experiments'] }); onClose(); },
  });
  const area = (k, rows, help, label) => (
    <Field label={label} help={help}>{(p) => <textarea {...p} className="input" rows={rows} value={form[k]} onChange={set(k)} />}</Field>
  );
  return (
    <form className="stack" style={{ gap: '0.875rem' }} onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="Título">{(p) => <input {...p} className="input" required minLength={3} maxLength={160} value={form.title} onChange={set('title')} />}</Field>
      <Field label="Estado">{(p) => (
        <select {...p} className="select" value={form.status} onChange={set('status')}>
          {LAB_ORDER.map((k) => <option key={k} value={k}>{LAB_STATUS[k].label}</option>)}
        </select>
      )}</Field>
      {area('hypothesis', 3, 'O que se espera que aconteça.', 'Hipótese')}
      {area('metric', 2, 'O número ou a observação que diz se funcionou.', 'Como se mede')}
      {area('result', 4, 'O que se aprendeu, a decisão e porquê (também quando não funcionou).', 'Resultado')}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Field label="Início">{(p) => <input {...p} type="date" className="input" value={form.startedOn} onChange={set('startedOn')} />}</Field>
        <Field label="Decisão">{(p) => <input {...p} type="date" className="input" value={form.decidedOn} onChange={set('decidedOn')} />}</Field>
      </div>
      {(save.error || remove.error) && <Notice tone="error">{errorMessage(save.error ?? remove.error)}</Notice>}
      <div className="modal-actions">
        {!isNew && (
          <Button variant="danger" className="button-ghost" busy={remove.isPending} style={{ marginRight: 'auto' }}
            onClick={() => { if (window.confirm(`Apagar «${experiment.title}»? Prefira «Abandonada»: as experiências que não funcionaram também ensinam.`)) remove.mutate(); }}>
            Apagar
          </Button>
        )}
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" type="submit" busy={save.isPending}>{isNew ? 'Registar' : 'Guardar'}</Button>
      </div>
    </form>
  );
}

/** Uma experiência: título, estado, hipótese, medida e resultado. */
function ExperimentCard({ e, onEdit }) {
  const st = LAB_STATUS[e.status];
  const when = e.decidedOn ? `decidida a ${f.date(e.decidedOn)}` : e.startedOn ? `desde ${f.date(e.startedOn)}` : null;
  return (
    <article className="card lab-card">
      <div className="card-head" style={{ marginBottom: '0.5rem', alignItems: 'flex-start' }}>
        <div>
          <h3 className="lab-title">{e.title}</h3>
          <p className="small muted" style={{ margin: 0 }}><span className={`badge ${st.tone}`}>{st.label}</span>{when && <> · {when}</>}</p>
        </div>
        <Button size="small" className="button-ghost" onClick={() => onEdit(e)} aria-label={`Editar ${e.title}`}><Icon name="edit" size={16} />Editar</Button>
      </div>
      <dl className="lab-fields">
        {e.hypothesis && <><dt>Hipótese</dt><dd>{e.hypothesis}</dd></>}
        {e.metric && <><dt>Como se mede</dt><dd>{e.metric}</dd></>}
        {e.result ? <><dt>Resultado</dt><dd>{e.result}</dd></> : e.status !== 'idea' && <><dt>Resultado</dt><dd className="muted">por registar</dd></>}
      </dl>
    </article>
  );
}

/**
 * Laboratório: o registo das experiências feitas no sistema (estratégias, análises, mudanças), com a hipótese, a forma
 * de medir e o que se aprendeu, incluindo as que não funcionaram, para não serem repetidas.
 */
export default function LabPage() {
  const q = useQuery({ queryKey: ['experiments'], queryFn: () => api.get('/experiments') });
  const [status, setStatus] = useState('all');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null); // null fechado; {} nova; experiência a editar
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const counts = countByStatus(items);
  const rows = useMemo(() => filterExperiments(items, { status, q: text }), [items, status, text]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Laboratório</h1>
          <p className="page-sub">
            As experiências feitas no sistema: o que se esperava, como se mediu e o que se aprendeu, também quando não funcionou, para
            saber o que já foi testado e não repetir ideias abandonadas.
          </p>
        </div>
        <Button variant="primary" onClick={() => setEditing({})}><Icon name="plus" size={18} />Nova experiência</Button>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Segmented label="Estado" value={status} onChange={setStatus}
          options={[{ value: 'all', label: `Todas (${items.length})` }, ...LAB_ORDER.map((k) => ({ value: k, label: `${LAB_STATUS[k].label} (${counts[k]})` }))]} />
        <div>
          <label className="visually-hidden" htmlFor="lab-q">Procurar nas experiências</label>
          <input id="lab-q" className="input input-sm" type="search" placeholder="Procurar" value={text} onChange={(e) => setText(e.target.value)} style={{ width: '14rem' }} />
        </div>
      </div>

      {q.isPending ? <Loading rows={6} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : rows.length === 0 ? (
        <section className="card">
          <EmptyState title={items.length ? 'Nenhuma experiência com estes filtros' : 'Ainda sem experiências'}>
            {items.length ? 'Mude o estado ou o texto procurado.' : 'Registe a primeira ideia: o que espera que aconteça e como vai medir.'}
          </EmptyState>
        </section>
      ) : (
        <div className="lab-grid">{rows.map((e) => <ExperimentCard key={e.id} e={e} onEdit={setEditing} />)}</div>
      )}

      <Dialog open={editing != null} onClose={() => setEditing(null)} title={editing?.id ? 'Editar experiência' : 'Nova experiência'}>
        {editing != null && <ExperimentDialog experiment={editing} onClose={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}
