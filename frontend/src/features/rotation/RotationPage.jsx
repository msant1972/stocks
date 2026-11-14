import { lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Field, Notice, Segmented } from '../../components/ui/controls.jsx';

const RotationChart = lazy(() => import('./RotationChart.jsx'));

const PERIODS = [{ value: 'recent', label: 'Últimos 2 anos' }, { value: 'verification', label: 'Verificação' }];
const POSITIONS = [5, 10, 20];
const pct1 = (v) => (v == null ? '—' : `${v.toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const signedPct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${pct1(v)}`);
const kEur = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${(v / 1000).toLocaleString('pt-PT', { maximumFractionDigits: 0 })} k€`);

const Link2 = ({ id, symbol }) => <Link to={`/charts?instrumento=${id}`} className="row-link">{symbol}</Link>;

/** Lista de instrumentos da revisão seguinte (comprar, manter, vender). */
function PickTable({ title, hint, items, empty, withReason }) {
  return (
    <div>
      <h3 className="card-title" style={{ fontSize: '1rem' }}>{title} <span className="muted small">({items.length})</span></h3>
      <p className="small muted" style={{ margin: '0.125rem 0 0.5rem' }}>{hint}</p>
      {items.length === 0 ? <p className="small muted">{empty}</p> : (
        <div className="table-wrap" tabIndex={0} aria-label={title}>
          <table className="data">
            <thead><tr><th scope="col">Instrumento</th><th scope="col" className="r">Lugar</th><th scope="col" className="r">Momentum 12-1</th></tr></thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.instrumentId}>
                  <td><Link2 id={x.instrumentId} symbol={x.symbol} /><div className="small muted">{x.name}</div></td>
                  <td className="r">{x.rank ?? '—'}</td>
                  <td className="r">{x.momentum == null ? (withReason ? <span className="muted" title="Já não cumpre momentum positivo, tendência ou liquidez">fora do filtro</span> : '—') : signedPct(x.momentum * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Rotação por momentum relativo (estratégia de carteira): ordena o catálogo pelo momentum de 12 meses sem o último e mantém os
 * N melhores, revistos no último dia útil de cada mês. Mostra o resultado simulado, a carteira actual e a revisão seguinte.
 */
export default function RotationPage() {
  const [params, setParams] = useSearchParams();
  const period = PERIODS.some((p) => p.value === params.get('periodo')) ? params.get('periodo') : 'recent';
  const positions = POSITIONS.includes(Number(params.get('posicoes'))) ? Number(params.get('posicoes')) : 10;
  const scope = params.get('lista') === '1' ? 'watchlist' : 'all';
  const set = (key, value, fallback) => {
    const next = new URLSearchParams(params);
    if (String(value) === String(fallback)) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };
  const q = useQuery({
    queryKey: ['rotation', period, positions, scope],
    queryFn: () => api.get(`/strategies/rotation?period=${period}&positions=${positions}&scope=${scope}`),
    placeholderData: (prev) => prev, staleTime: 5 * 60_000,
  });
  const r = q.data;
  const s = r?.summary;
  const bh = s?.buyHold;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Rotação</h1>
          <p className="page-sub">
            Estratégia de carteira: no último dia útil de cada mês ordena os instrumentos pelo momentum de 12 meses sem o último e mantém os
            {' '}{positions} melhores (só com momentum positivo, acima da SMA200 e com liquidez), com um lote de 15 000 € cada. Compra à abertura
            seguinte; uma posição só sai por ranking quando cai para além do lugar {positions * 2}. Simulação sobre cotações diárias, sem ordens.
          </p>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Segmented label="Instrumentos" value={scope} onChange={(v) => set('lista', v === 'watchlist' ? '1' : '0', '0')}
            options={[{ value: 'all', label: 'Todos' }, { value: 'watchlist', label: 'A minha lista' }]} />
          <Segmented label="Período" value={period} onChange={(v) => set('periodo', v, 'recent')} options={PERIODS} />
          <div style={{ minWidth: '8rem' }}>
            <Field label="Posições">
              {(p) => (
                <select {...p} className="select" value={positions} onChange={(e) => set('posicoes', e.target.value, 10)} style={{ minHeight: '2.75rem' }}>
                  {POSITIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </Field>
          </div>
        </div>
      </div>

      {q.isPending ? <Loading rows={6} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !r.firstDate ? (
        <EmptyState title="Sem dados para simular">Não há instrumentos com histórico suficiente (pelo menos 12 meses de cotações).</EmptyState>
      ) : (
        <>
          {scope === 'watchlist' && r.universe < positions * 2 && (
            <Notice tone="info">A sua lista tem {r.universe} instrumentos: com tão poucos, a rotação não consegue escolher entre eles. Use «Todos» para o catálogo inteiro.</Notice>
          )}
          <section className="card" aria-labelledby="rot-result" style={{ opacity: q.isFetching ? 0.6 : 1 }}>
            <h2 id="rot-result" className="card-title" style={{ marginBottom: '0.75rem' }}>
              Resultado simulado · {f.date(r.firstDate)} a {f.date(r.lastDate)}
            </h2>
            <dl className="kpis">
              <div><dt>Depois de custos</dt><dd className={s.net >= 0 ? 'positive' : 'negative'}>{f.signedMoney(s.net)}</dd></div>
              <div><dt>Sobre o capital máximo ({f.money(s.peakCost, 'EUR', 0)})</dt><dd className={s.netPct >= 0 ? 'positive' : 'negative'}>{signedPct(s.netPct)}</dd></div>
              <div><dt>Comprar e manter o universo{bh ? ` (${bh.instruments})` : ''}</dt><dd>{bh ? signedPct(bh.netPct) : '—'}</dd></div>
              <div><dt>Pior queda do resultado</dt><dd className="negative">{f.signedMoney(s.maxDrawdown)} ({pct1(s.maxDrawdownPct)})</dd></div>
              <div><dt>Operações fechadas · acerto</dt><dd>{s.closed} · {s.closed ? pct1((100 * s.wins) / s.closed) : '—'}</dd></div>
              <div><dt>Custos estimados</dt><dd>{f.money(s.costs, 'EUR', 0)}</dd></div>
            </dl>
            <p className="small muted" style={{ marginTop: '0.75rem' }}>
              Custos da SAXO estimados como no BackTest (comissão, spread e custódia). «Sobre o capital máximo» é o resultado a dividir pelo máximo
              investido ao mesmo tempo; comprar e manter investe um lote em cada instrumento do universo. O catálogo é o de hoje: as empresas que
              saíram da bolsa não entram, o que favorece todos os resultados.
            </p>
            {r.curve.length > 1 && <Suspense fallback={<Loading rows={3} />}><RotationChart curve={r.curve} /></Suspense>}
          </section>

          <section className="card" aria-labelledby="rot-next">
            <h2 id="rot-next" className="card-title" style={{ marginBottom: '0.25rem' }}>Próxima revisão</h2>
            <p className="small muted" style={{ marginTop: 0 }}>
              Com os dados de {f.date(r.next.date)}: {r.next.eligible} instrumentos elegíveis. A revisão verdadeira faz-se no último dia útil do mês e as
              ordens seguem à abertura seguinte. Isto é uma indicação para decisão manual: a Automação não usa esta estratégia.
            </p>
            <div className="grid" style={{ marginTop: '0.75rem' }}>
              <div className="span-4"><PickTable title="Comprar" hint="Entram, pela ordem do ranking." items={r.next.buy} empty="Nada a comprar." /></div>
              <div className="span-4"><PickTable title="Manter" hint="Continuam elegíveis e dentro do lugar de manutenção." items={r.next.keep} empty="Nenhuma posição a manter." /></div>
              <div className="span-4"><PickTable title="Vender" hint="Caíram para além do lugar de manutenção ou deixaram de ser elegíveis." items={r.next.sell} empty="Nada a vender." withReason /></div>
            </div>
          </section>

          <section className="card" aria-labelledby="rot-open">
            <h2 id="rot-open" className="card-title" style={{ marginBottom: '0.75rem' }}>Posições abertas na simulação <span className="muted small">({r.open.length})</span></h2>
            {r.open.length === 0 ? <p className="small muted">Sem posições abertas.</p> : (
              <div className="table-wrap" tabIndex={0} aria-label="Posições abertas na simulação">
                <table className="data">
                  <thead><tr><th scope="col">Instrumento</th><th scope="col">Compra</th><th scope="col" className="r">Quantidade</th><th scope="col" className="r">Custo</th><th scope="col" className="r">Valor</th><th scope="col" className="r">Resultado</th></tr></thead>
                  <tbody>
                    {r.open.map((p) => (
                      <tr key={p.instrumentId}>
                        <td><Link2 id={p.instrumentId} symbol={p.symbol} /><div className="small muted">{p.name}</div></td>
                        <td className="small">{f.date(p.buyDate)}</td>
                        <td className="r">{f.quantity(p.quantity)}</td>
                        <td className="r">{f.money(p.cost)}</td>
                        <td className="r">{f.money(p.value)}</td>
                        <td className={`r ${p.pnl >= 0 ? 'positive' : 'negative'}`}>{f.signedMoney(p.pnl)} <span className="small">({signedPct(p.pnlPct)})</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="rot-trades">
            <h2 id="rot-trades" className="card-title" style={{ marginBottom: '0.75rem' }}>Operações fechadas <span className="muted small">({r.trades.length}; as 100 mais recentes)</span></h2>
            {r.trades.length === 0 ? <p className="small muted">Ainda sem operações fechadas.</p> : (
              <div className="table-wrap" tabIndex={0} aria-label="Operações fechadas" style={{ maxHeight: 480, overflowY: 'auto' }}>
                <table className="data">
                  <thead><tr><th scope="col">Instrumento</th><th scope="col">Compra</th><th scope="col">Venda</th><th scope="col" className="r">Custo</th><th scope="col" className="r">Resultado</th></tr></thead>
                  <tbody>
                    {r.trades.slice(0, 100).map((t, k) => (
                      <tr key={`${t.instrumentId}-${t.buyDate}-${k}`}>
                        <td><Link2 id={t.instrumentId} symbol={t.symbol} /><div className="small muted">{t.name}</div></td>
                        <td className="small">{f.date(t.buyDate)}</td>
                        <td className="small">{f.date(t.sellDate)}</td>
                        <td className="r">{f.money(t.cost)}</td>
                        <td className={`r ${t.pnl >= 0 ? 'positive' : 'negative'}`}>{f.signedMoney(t.pnl)} <span className="small">({signedPct(t.pnlPct)})</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="small muted" style={{ marginTop: '0.5rem' }}>Total de {kEur(s.realized)} em operações fechadas e {kEur(s.unrealized)} em posições abertas, antes de custos.</p>
          </section>
        </>
      )}
    </>
  );
}
