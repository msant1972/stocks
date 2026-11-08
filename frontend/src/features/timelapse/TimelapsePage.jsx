import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { bigMoney } from '../../lib/company.js';
import { allFrameIds, biggestMoves, colorSlots, deltaLabel, frameRows } from '../../lib/timelapse.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Button, Notice, Segmented } from '../../components/ui/controls.jsx';

const WINDOWS = [1, 5, 10];
const UNIVERSES = [{ value: 'lista', label: 'A minha lista' }, { value: 'saxo', label: 'Saxo' }, { value: 'catalogo', label: 'Catálogo' }];
const STEP_MS = 2000;
const ROW = 26; // altura de cada barra, em px

/**
 * Timelapse: o top 30 dos instrumentos pelo valor negociado das últimas 1, 5 ou 10 sessões, animado sessão a sessão nas
 * últimas 22 sessões (uma sessão a cada 2 s). Mostra quem ganha e quem perde peso no top. Cada instrumento tem a sua cor
 * (8 cores, que se repetem); clicar numa barra destaca esse instrumento. Universo: a minha lista, as posições da conta SAXO
 * ou todo o catálogo.
 */
export default function TimelapsePage() {
  const [params, setParams] = useSearchParams();
  const universe = UNIVERSES.some((u) => u.value === params.get('universo')) ? params.get('universo') : 'catalogo';
  const windowSize = WINDOWS.includes(Number(params.get('sessoes'))) ? Number(params.get('sessoes')) : 10;
  const setParam = (key, value) => setParams((cur) => { const next = new URLSearchParams(cur); next.set(key, value); return next; }, { replace: true });
  const q = useQuery({
    queryKey: ['market', 'timelapse', universe, windowSize],
    queryFn: () => api.get(`/market/timelapse?universe=${universe}&window=${windowSize}`), staleTime: 10 * 60_000, retry: false,
  });
  const [focus, setFocus] = useState(null); // instrumento destacado (clique na barra)
  const frames = useMemo(() => q.data?.frames ?? [], [q.data]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = frames.length - 1;

  // Universo novo: volta ao início e começa a tocar.
  useEffect(() => { setIndex(0); setPlaying(frames.length > 1); setFocus(null); }, [frames]);
  useEffect(() => {
    if (!playing) return undefined;
    if (index >= last) { setPlaying(false); return undefined; }
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, last)), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, index, last]);

  const ids = useMemo(() => allFrameIds(frames), [frames]);
  const colors = useMemo(() => colorSlots(ids), [ids]);
  const names = useMemo(() => new Map((q.data?.instruments ?? []).map((i) => [i.id, i])), [q.data]);
  const rows = useMemo(() => (frames.length ? frameRows(frames, Math.min(index, last), ids) : []), [frames, index, last, ids]);
  const frame = frames[Math.min(index, last)];
  const top = q.data?.top ?? 30;
  const max = frame?.items[0]?.value || 1;
  const moves = useMemo(() => biggestMoves(frames), [frames]);
  const sym = (id) => names.get(id)?.symbol ?? String(id);
  const play = () => { if (index >= last) setIndex(0); setPlaying(true); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Timelapse</h1>
          <p className="page-sub">
            Os {top} instrumentos com mais valor negociado {windowSize === 1 ? 'em cada sessão' : `nas últimas ${windowSize} sessões`}, sessão a sessão nas
            últimas 22: quem ganha e quem perde peso no top. Valor negociado = volume × (abertura + mínimo + máximo + fecho) / 4, em euros.
            Clique numa barra para seguir esse instrumento.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="small" htmlFor="tl-window">Sessões somadas</label>
          <select id="tl-window" value={windowSize} onChange={(e) => setParam('sessoes', e.target.value)} style={{ width: 'auto' }}>
            {WINDOWS.map((w) => <option key={w} value={w}>{w === 1 ? '1 sessão' : `${w} sessões`}</option>)}
          </select>
          <Segmented label="Universo" value={universe} onChange={(v) => setParam('universo', v)} options={UNIVERSES} />
        </div>
      </div>

      <section className="card" aria-labelledby="tl-title">
        <div className="card-head">
          <h2 id="tl-title" className="card-title">Top {top} · valor negociado {windowSize === 1 ? 'da sessão' : `de ${windowSize} sessões`}</h2>
          {q.data && <span className="small muted">{q.data.size} instrumentos no universo</span>}
        </div>
        {q.isPending ? <Loading rows={8} label="A calcular o top de cada sessão…" />
          : q.error ? (['SAXO_NO_TOKEN', 'SAXO_TOKEN_EXPIRED'].includes(q.error.code)
            ? <Notice tone="info">{errorMessage(q.error)} <Link to="/definicoes">Abrir Definições</Link></Notice>
            : <ErrorState error={q.error} onRetry={q.refetch} />)
            : frames.length === 0 ? (
              <EmptyState title="Sem dados">{universe === 'lista' ? 'A sua lista não tem instrumentos com negócios.' : universe === 'saxo' ? 'A conta SAXO não tem posições de instrumentos do catálogo.' : 'Ainda não há sessões suficientes.'}</EmptyState>
            ) : (
              <>
                <div className={`timelapse-chart${focus != null ? ' has-focus' : ''}`} style={{ height: `${top * ROW + 8}px` }} role="group"
                  aria-label={`Top ${top} na sessão de ${f.date(frame.date)}`}>
                  {rows.map((r) => (
                    <button type="button" key={r.id} className={`timelapse-row${r.rank == null ? ' is-out' : ''}${focus === r.id ? ' is-focus' : ''}`}
                      style={{ transform: `translateY(${(r.rank ?? top) * ROW}px)` }} tabIndex={r.rank == null ? -1 : 0} aria-hidden={r.rank == null}
                      aria-pressed={focus === r.id} onClick={() => setFocus((cur) => (cur === r.id ? null : r.id))}
                      aria-label={r.rank == null ? undefined : `${r.rank + 1}.º ${sym(r.id)}, ${bigMoney(r.value)}${deltaLabel(r) ? `, ${deltaLabel(r)}` : ''}${focus === r.id ? ' (destacado)' : ''}`}
                      title={names.get(r.id)?.name ?? ''}>
                      <span className="timelapse-label">{r.rank == null ? '' : `${r.rank + 1}. `}{sym(r.id)}</span>
                      <span className="timelapse-track">
                        <span className="timelapse-bar" data-color={colors.get(r.id)} style={{ width: `calc((100% - var(--tl-value-space)) * ${Math.max(0.005, r.value / max)})` }} />
                        <span className="timelapse-value num">{r.rank == null ? '' : bigMoney(r.value)}</span>
                      </span>
                      <span className={`timelapse-delta small ${r.isNew || r.delta > 0 ? 'positive' : r.delta < 0 ? 'negative' : 'muted'}`}>{deltaLabel(r)}</span>
                    </button>
                  ))}
                  <div className="timelapse-date" aria-hidden="true">
                    <span className="num">{f.date(frame.date)}</span>
                    {windowSize > 1 && <span className="small muted">{windowSize} sessões desde {f.date(frame.from)}</span>}
                  </div>
                </div>

                <div className="timelapse-controls">
                  <span className="small muted">{f.date(frames[0].date)}</span>
                  <div className="timelapse-buttons">
                    <Button size="small" onClick={() => { setPlaying(false); setIndex(0); }} title="Primeira sessão" aria-label="Primeira sessão">|◀</Button>
                    <Button size="small" onClick={() => { setPlaying(false); setIndex((i) => Math.max(0, i - 1)); }} disabled={index === 0} aria-label="Sessão anterior">◀</Button>
                    {playing
                      ? <Button size="small" variant="primary" onClick={() => setPlaying(false)} aria-label="Pausa">❚❚</Button>
                      : <Button size="small" variant="primary" onClick={play} aria-label="Reproduzir">▶</Button>}
                    <Button size="small" onClick={() => { setPlaying(false); setIndex((i) => Math.min(last, i + 1)); }} disabled={index >= last} aria-label="Sessão seguinte">▶|</Button>
                    <Button size="small" onClick={() => { setPlaying(false); setIndex(last); }} title="Última sessão" aria-label="Última sessão">▶▶|</Button>
                  </div>
                  <span className="small muted">{f.date(frames[last].date)}</span>
                </div>
                <label className="visually-hidden" htmlFor="tl-scrub">Sessão</label>
                <input id="tl-scrub" type="range" className="timelapse-scrub" min={0} max={last} value={Math.min(index, last)}
                  onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} aria-valuetext={f.date(frame.date)} />
                <p className="small muted" aria-live="polite" style={{ margin: '0.25rem 0 0' }}>
                  Sessão {index + 1} de {frames.length}: {f.date(frame.date)}.
                  {moves.up && <> Mais subiu no período: <strong>{sym(moves.up.id)}</strong> (▲ {moves.up.delta}).</>}
                  {moves.down && <> Mais desceu: <strong>{sym(moves.down.id)}</strong> (▼ {-moves.down.delta}).</>}
                  {focus != null && <> A seguir <strong>{sym(focus)}</strong> (clique de novo na barra para largar).</>}
                  {q.data.partialExcluded && <> A sessão em curso ({f.date(q.data.partialExcluded)}) entra depois da recolha das 19:00.</>}
                </p>

                <details style={{ marginTop: '0.75rem' }}>
                  <summary className="small">Ver os dados desta sessão</summary>
                  <div className="table-wrap" tabIndex={0} aria-label={`Top ${top} na sessão de ${f.date(frame.date)}`}>
                    <table className="data">
                      <thead><tr><th scope="col" className="r">#</th><th scope="col">Instrumento</th><th scope="col" className="r">Valor negociado ({windowSize === 1 ? '1 sessão' : `${windowSize} sessões`})</th><th scope="col" className="r">Variação</th></tr></thead>
                      <tbody>
                        {rows.filter((r) => r.rank != null).sort((a, b) => a.rank - b.rank).map((r) => (
                          <tr key={r.id}>
                            <td className="r num">{r.rank + 1}</td>
                            <td><span className="swatch-inline" style={{ background: `var(--cat-${colors.get(r.id)})` }} /> <Link to={`/charts?instrumento=${r.id}`} className="row-link">{sym(r.id)}</Link> <span className="small muted">{names.get(r.id)?.name}</span></td>
                            <td className="r num">{bigMoney(r.value)}</td>
                            <td className="r">{deltaLabel(r) || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
      </section>
    </>
  );
}
