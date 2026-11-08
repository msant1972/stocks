import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { candidateLabel, filterMatches, MATCH_ORDER, MATCH_STATUS } from '../../lib/saxo.js';
import { ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Button, Notice, Segmented } from '../../components/ui/controls.jsx';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);

/** Escolha manual: lista de candidatos da SAXO ou, sem candidatos, o Uic escrito à mão. */
function Chooser({ item, onChoose, busy }) {
  const [uic, setUic] = useState(item.candidates[0]?.uic ? String(item.candidates[0].uic) : '');
  const id = `uic-${item.instrumentId}`;
  return (
    <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <label htmlFor={id} className="visually-hidden">Instrumento da SAXO para {item.symbol}</label>
      {item.candidates.length ? (
        <select id={id} className="select select-sm" value={uic} onChange={(e) => setUic(e.target.value)} style={{ maxWidth: '22rem' }}>
          {item.candidates.map((c) => <option key={c.uic} value={c.uic}>{candidateLabel(c)}</option>)}
        </select>
      ) : (
        <input id={id} className="input input-sm" inputMode="numeric" placeholder="Uic da SAXO" value={uic} onChange={(e) => setUic(e.target.value.replace(/\D/g, ''))} style={{ width: '8rem' }} />
      )}
      <Button size="small" busy={busy} disabled={!uic} onClick={() => onChoose(Number(uic))}>Escolher</Button>
    </div>
  );
}

/**
 * Correspondência SAXO (administradores): estado de cada instrumento do catálogo face à SAXO Bank, ligação do catálogo
 * inteiro em segundo plano e resolução manual do que ficou ambíguo, só noutra bolsa ou por encontrar.
 */
export default function SaxoMatchPage() {
  const qc = useQueryClient();
  const [view, setView] = useState('todo');
  const [q, setQ] = useState('');
  const data = useQuery({
    queryKey: ['saxo-catalog'], queryFn: () => api.get('/saxo/catalog'),
    refetchInterval: (query) => (query.state.data?.lastRun?.status === 'running' ? 3000 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['saxo-catalog'] });
  const sync = useMutation({ mutationFn: (recheck) => api.post('/saxo/catalog/sync', { recheck }), onSettled: refresh });
  const choose = useMutation({ mutationFn: ({ id, uic }) => api.post(`/saxo/instruments/${id}/match`, { uic }), onSettled: refresh });
  const unlink = useMutation({ mutationFn: (id) => api.del(`/saxo/instruments/${id}/match`), onSettled: refresh });
  const rows = useMemo(() => filterMatches(data.data?.items ?? [], { view, q }), [data.data, view, q]);
  const run = data.data?.lastRun;
  const running = run?.status === 'running';
  const s = data.data?.summary ?? {};
  const total = data.data?.items.length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Correspondência SAXO</h1>
          <p className="page-sub">
            Que instrumento da SAXO Bank corresponde a cada instrumento do catálogo (símbolos do Yahoo). A ligação procura pelo
            ISIN, pela raiz do símbolo e pelo nome da empresa, sempre na bolsa certa, e só aceita sozinha quando o nome coincide;
            o resto fica aqui para escolher. Revalidação automática uma vez por semana.
          </p>
        </div>
      </div>

      <section className="card" aria-labelledby="saxo-match-summary">
        <div className="card-head">
          <h2 id="saxo-match-summary" className="card-title">Resumo · {data.data?.environment === 'live' ? 'conta real' : 'simulação (SIM)'}</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button variant="primary" busy={sync.isPending} disabled={running} onClick={() => sync.mutate(false)}>Ligar o catálogo</Button>
            <Button busy={sync.isPending} disabled={running} onClick={() => sync.mutate(true)}>Ligar e revalidar todos</Button>
          </div>
        </div>
        {sync.error && <Notice tone="error">{errorMessage(sync.error)}</Notice>}
        {data.isPending ? <Loading rows={2} /> : data.error ? <ErrorState error={data.error} onRetry={data.refetch} /> : (
          <>
            <div className="legend-chips" style={{ margin: '0.25rem 0 0.75rem' }}>
              {MATCH_ORDER.filter((k) => s[k]).map((k) => (
                <span key={k} className="legend-chip static" title={MATCH_STATUS[k].help}>
                  <span className={MATCH_STATUS[k].tone}>{MATCH_STATUS[k].label}</span>&nbsp;<strong className="num">{s[k]}</strong>
                </span>
              ))}
              <span className="small muted" style={{ alignSelf: 'center' }}>de {total} instrumentos activos</span>
            </div>
            {run ? (
              <p className="small muted" style={{ margin: 0 }} aria-live="polite">
                {running
                  ? <>A ligar o catálogo: <strong className="num">{run.processed}</strong> de {run.total} instrumentos ({run.recheck ? 'com revalidação' : 'só os por ligar'})…</>
                  : <>Última ligação {run.trigger === 'weekly' ? '(semanal, automática)' : `(${run.userName ?? 'manual'})`}: {f.dateTime(run.finishedAt ?? run.startedAt)} ·{' '}
                    {run.status === 'done' ? 'concluída' : `falhou${run.detail ? `: ${run.detail}` : ''}`}
                    {Object.keys(run.counts).length > 0 && <> · {Object.entries(run.counts).map(([k, v]) => `${MATCH_STATUS[k]?.label ?? (k === 'rechecked' ? 'revalidados' : k === 'skipped' ? 'já ligados' : k)} ${v}`).join(', ')}</>}
                  </>}
              </p>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                Ainda não se ligou o catálogo: as correspondências fazem-se na primeira ordem de cada instrumento. «Ligar o catálogo» procura
                todos de uma vez (cerca de 1–2 s por instrumento, com o seu token da SAXO; <Link to="/definicoes">Definições → SAXO Bank</Link>).
              </p>
            )}
          </>
        )}
      </section>

      <section className="card" aria-labelledby="saxo-match-title">
        <div className="card-head">
          <h2 id="saxo-match-title" className="card-title">Instrumentos</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Segmented label="Mostrar" value={view} onChange={setView}
              options={[{ value: 'todo', label: 'Por resolver' }, { value: 'linked', label: 'Ligados' }, { value: 'all', label: 'Todos' }]} />
            <label className="visually-hidden" htmlFor="saxo-match-q">Procurar</label>
            <input id="saxo-match-q" className="input input-sm" type="search" placeholder="Procurar" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '10rem' }} />
          </div>
        </div>
        {(choose.error || unlink.error) && <Notice tone="error">{errorMessage(choose.error ?? unlink.error)}</Notice>}
        {data.isPending ? <Loading rows={6} /> : data.error ? null : rows.length === 0 ? (
          <p className="small muted">{view === 'todo' ? 'Nada por resolver.' : 'Sem instrumentos.'}</p>
        ) : (
          <div className="table-wrap" tabIndex={0} aria-label="Correspondência dos instrumentos com a SAXO">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Instrumento (Yahoo)</th><th scope="col">Estado</th><th scope="col">SAXO</th>
                  <th scope="col" className="r">Nome</th><th scope="col"><span className="visually-hidden">Acções</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const st = MATCH_STATUS[i.status];
                  return (
                    <tr key={i.instrumentId}>
                      <th scope="row">
                        <Link to={`/instrumentos/${i.instrumentId}`} className="row-link">{i.symbol}</Link>
                        <div className="small muted">{i.name} · {i.exchange}{i.isin ? ` · ${i.isin}` : ''}</div>
                      </th>
                      <td><span className={st.tone} title={st.help}>{st.label}</span>{i.saxo?.source === 'manual' && <div className="small muted">escolha manual</div>}</td>
                      <td>
                        {i.saxo ? (
                          <><span className="num">{i.saxo.symbol}</span><div className="small muted">{i.saxo.description} · {i.saxo.exchangeId} · Uic {i.saxo.uic}</div></>
                        ) : <span className="small muted">{i.message ?? '—'}</span>}
                      </td>
                      <td className="r num" title="Semelhança entre o nome do Yahoo e o da SAXO">{pct(i.saxo?.nameScore)}</td>
                      <td className="r">
                        {i.saxo ? (
                          <Button size="small" busy={unlink.isPending && unlink.variables === i.instrumentId}
                            onClick={() => { if (window.confirm(`Desligar ${i.symbol} de ${i.saxo.symbol}?`)) unlink.mutate(i.instrumentId); }}>Desligar</Button>
                        ) : (
                          <Chooser item={i} busy={choose.isPending && choose.variables?.id === i.instrumentId} onChoose={(uic) => choose.mutate({ id: i.instrumentId, uic })} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
