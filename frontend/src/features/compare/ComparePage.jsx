import { Link, useSearchParams } from 'react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Segmented } from '../../components/ui/controls.jsx';
import { conditionParams, conditionQuery, describeConditions, readConditions } from '../../lib/testConditions.js';
import { rankings } from '../../lib/compare.js';
import { ConditionControls, ConditionsNote } from '../backtest/Conditions.jsx';

const kEur = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${(v / 1000).toLocaleString('pt-PT', { maximumFractionDigits: 0 })} k€`);
const pct = (v) => (v == null ? '—' : `${v.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}%`);

/**
 * Linhas do quadro. better: 'max' ou 'min' destaca o melhor valor entre as estratégias (comprar e manter é só
 * referência e não entra no destaque); sem better, nada é destacado.
 */
const ROWS = [
  { label: 'Resultado total', value: (s) => s.total, fmt: kEur, better: 'max', strong: true },
  { label: 'Instrumentos com ganho / perda', value: (s) => s.gain, fmt: (_, s) => `${s.gain} / ${s.loss}`, better: 'max' },
  { label: 'Capital máximo investido (soma)', value: (s) => s.peakCost, fmt: (v) => `${(v / 1e6).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} M€` },
  { label: 'Resultado sobre o capital máximo', value: (s) => s.returnOnPeakPct, fmt: pct, better: 'max',
    title: 'Resultado total ÷ soma do capital máximo investido em cada instrumento' },
  { label: 'Tempo investido', value: (s) => s.investedPct, fmt: pct, title: 'Sessões com posição aberta, em % das sessões da janela' },
  { label: 'Operações', value: (s) => s.positions, fmt: (v) => f.quantity(v) },
  { label: 'Taxa de acerto', value: (s) => s.winRate, fmt: pct, better: 'max', title: 'Operações fechadas com ganho' },
  { label: 'Pior instrumento', value: (s) => s.worst, fmt: (v) => (v == null ? '—' : f.signedMoney(v)), better: 'max' },
  { label: 'Soma dos 10 piores', value: (s) => s.worst10, fmt: kEur, better: 'max' },
  { label: '1.º ano', value: (s) => s.firstYear, fmt: kEur, better: 'max', title: 'Resultado das vendas feitas no 1.º ano da janela' },
  { label: '2.º ano', value: (s) => s.secondYear, fmt: kEur, better: 'max', title: 'Resultado das vendas do 2.º ano e da posição aberta no fim' },
  { label: 'Melhor estratégia em', value: (s) => s.bestIn, fmt: (v) => (v == null ? '—' : `${v} instrumentos`), better: 'max' },
];

const GROUP_LABEL = { gain: 'Ganharam com todas', mixed: 'Resultados mistos', loss: 'Perderam com todas' };

/** Persistência: os instrumentos agrupados pelo 1.º ano e o que aconteceu no 2.º (recálculo semanal). */
function Persistence({ p }) {
  return (
    <details className="small" style={{ marginTop: '1rem' }}>
      <summary>Os ganhadores e os perdedores de um ano continuam a sê-lo no seguinte?</summary>
      <div className="table-wrap" style={{ marginTop: '0.5rem' }} tabIndex={0} aria-label="Persistência dos resultados">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">No 1.º ano</th>
              <th scope="col" className="r">Instrumentos</th>
              <th scope="col" className="r">No 2.º ano: ganham / mistos / perdem</th>
              <th scope="col" className="r">Estratégias no 2.º ano (média)</th>
              <th scope="col" className="r">Comprar e manter no 2.º ano (média)</th>
            </tr>
          </thead>
          <tbody>
            {p.groups.map((g) => (
              <tr key={g.group}>
                <th scope="row">{GROUP_LABEL[g.group]}</th>
                <td className="r num">{g.n}</td>
                <td className="r num">{g.gain} / {g.mixed} / {g.loss}</td>
                <td className="r num">{f.signedMoney(g.avgStrategies)}</td>
                <td className="r num">{f.signedMoney(g.avgBuyHold)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: '0.5rem' }}>
        Classificação pelo resultado de todas as estratégias no 1.º ano; as médias somam as estratégias por instrumento.
        Recalculado semanalmente (última vez: {f.dateTime(p.computedAt)}). Uma só divisão em dois anos: indicativo.
      </p>
    </details>
  );
}

const COMBOS = [
  { period: 'recent', costs: false, label: 'Últimos 2 anos' },
  { period: 'recent', costs: true, label: 'Últimos 2 anos, com custos' },
  { period: 'verification', costs: false, label: 'Verificação' },
  { period: 'verification', costs: true, label: 'Verificação, com custos' },
];

/**
 * A experiência «custos e período de verificação»: a ordem das estratégias pelo resultado sobre o capital em cada
 * combinação. Se a ordem se mantém, a classificação é de confiar; se muda muito, não era.
 */
function Consistency({ scope }) {
  const qs = useQueries({
    queries: COMBOS.map((c) => ({
      queryKey: ['strategies', 'compare', scope, c.period, c.costs],
      queryFn: () => api.get(`/strategies/compare?scope=${scope}&${conditionQuery(c)}`),
      staleTime: 10 * 60_000,
    })),
  });
  const ready = qs.every((q) => q.data);
  const failed = qs.find((q) => q.error);
  const r = ready ? rankings(qs.map((q) => q.data.items)) : null;
  return (
    <section className="card" aria-labelledby="consistency-title">
      <div className="card-head">
        <h2 id="consistency-title" className="card-title">A classificação aguenta?</h2>
        {r && <span className={`badge ${r.stable ? 'badge-positive' : 'badge-warning'}`}>{r.stable ? 'mesma ordem nas quatro condições' : 'a ordem muda'}</span>}
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Posição de cada estratégia pelo resultado sobre o capital máximo investido (1.º = melhor), com e sem custos, nos últimos 2 anos e nos
        2 anos antes (verificação: dados que não serviram para afinar as estratégias). Entre parêntesis, o resultado sobre o capital.
      </p>
      {failed ? <ErrorState error={failed.error} onRetry={() => qs.forEach((q) => q.refetch())} />
        : !r ? <Loading rows={4} label="A calcular as quatro condições (o período de verificação demora mais na primeira vez)…" /> : (
          <div className="table-wrap" tabIndex={0} aria-label="Posição das estratégias em cada condição">
            <table className="data">
              <thead>
                <tr><th scope="col">Estratégia</th>{COMBOS.map((c) => <th key={c.label} scope="col" className="r">{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.name}</th>
                    {row.cells.map((c, k) => (
                      <td key={COMBOS[k].label} className="r num" style={{ fontWeight: c.rank === 1 ? 600 : 400 }}>
                        {c.rank}.º <span className="muted">({pct(c.value)})</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

/** Comparar: as estratégias lado a lado, nos últimos 2 anos ou no período de verificação, com ou sem custos. */
export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const scope = params.get('lista') === '1' ? 'watchlist' : 'all';
  const conditions = readConditions(params);
  const cmp = useQuery({
    queryKey: ['strategies', 'compare', scope, conditions.period, conditions.costs],
    queryFn: () => api.get(`/strategies/compare?scope=${scope}&${conditionQuery(conditions)}`),
    staleTime: 10 * 60_000,
  });
  const setParam = (changes) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(changes)) { if (v == null) next.delete(k); else next.set(k, v); }
    return next;
  }, { replace: true });
  const setScope = (v) => setParam({ lista: v === 'watchlist' ? '1' : null });

  const d = cmp.data;
  const columns = d ? [...d.items, d.buyHold] : [];
  const bestOf = (row) => {
    if (!row.better || !d) return null;
    const vals = d.items.map(row.value).filter((v) => v != null);
    return vals.length ? (row.better === 'max' ? Math.max(...vals) : Math.min(...vals)) : null;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Comparar estratégias</h1>
          <p className="page-sub">
            As estratégias lado a lado {describeConditions(conditions, d?.years ?? 2)}, com {d ? f.money(d.budget, 'EUR', 0) : '15 000 €'} por compra,
            e comprar e manter como referência. Simulação no histórico; não são recomendações.
          </p>
        </div>
        <div className="row">
          <Link className="button mobile-only-inline" to="/backtest">BackTest</Link>
          <Segmented label="Instrumentos" value={scope} onChange={setScope}
            options={[{ value: 'all', label: 'Todos' }, { value: 'watchlist', label: 'A minha lista' }]} />
          <ConditionControls conditions={conditions} onChange={(c) => setParam(conditionParams(c))} />
        </div>
      </div>

      <section className="card" aria-labelledby="compare-title">
        <h2 id="compare-title" className="visually-hidden">Quadro comparativo</h2>
        {cmp.isPending ? <Loading rows={8} label="A calcular as estratégias…" /> : cmp.error ? <ErrorState error={cmp.error} onRetry={cmp.refetch} /> :
          d.instruments === 0 ? (
            <EmptyState title="Sem instrumentos" action={<Link className="button" to="/acompanhar">Acompanhar instrumentos</Link>}>
              A sua lista não tem instrumentos activos com cotações.
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap" tabIndex={0} aria-label="Quadro comparativo das estratégias">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">{d.instruments} instrumentos</th>
                      {columns.map((c) => (
                        <th key={c.id} scope="col" className="r">
                          {c.id === 'buy-hold' ? <em>{c.name}</em> : <Link to={`/backtest${c.id === 'a-momentum' ? '' : `?estrategia=${c.id}`}`}>{c.name}</Link>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => {
                      const best = bestOf(row);
                      return (
                        <tr key={row.label}>
                          <th scope="row" title={row.title} style={{ fontWeight: row.strong ? 600 : 400 }}>{row.label}</th>
                          {columns.map((c) => {
                            const v = row.value(c);
                            const top = c.id !== 'buy-hold' && v != null && v === best;
                            return (
                              <td key={c.id} className={`r num${c.id === 'buy-hold' ? ' muted' : ''}`} style={{ fontWeight: top || row.strong ? 600 : 400 }}>
                                {row.fmt(v, c)}{top && <span className="visually-hidden"> (melhor)</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: '0.75rem' }}><ConditionsNote data={d} conditions={conditions} /></div>
              {d.persistence && <Persistence p={d.persistence} />}
              <p className="small muted" style={{ marginTop: '0.75rem' }}>
                A negrito, o melhor valor entre as estratégias. O resultado sobre o capital mede o rendimento por euro investido: as estratégias
                com reforços sem limite (A-Momentum) investem muito mais capital. Comprar e manter está sempre investido; num período de subida
                é difícil de bater, e as estratégias protegem mais numa queda prolongada. A A-Momentum executa ao fecho do dia do sinal; as
                restantes, na abertura seguinte. Calculado {f.dateTime(d.computedAt)}.
              </p>
            </>
          )}
      </section>
      <Consistency scope={scope} />
    </>
  );
}
