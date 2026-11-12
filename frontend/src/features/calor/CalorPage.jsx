import { lazy, Suspense, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { bigMoney, signedPctOf } from '../../lib/company.js';
import { HEAT_LABELS, monthLabel, monthlyTotals, peakSession } from '../../lib/turnover.js';
import { ErrorState, Loading } from '../../components/feedback/states.jsx';

const TurnoverChart = lazy(() => import('../../components/finance/TurnoverChart.jsx'));
const MonthlyTurnoverChart = lazy(() => import('../../components/finance/MonthlyTurnoverChart.jsx'));

const lisbonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date());

/** Valor mensal negociado: histograma com os meses coloridos pelo quartil e tabela dos totais. */
function MonthlySection({ months }) {
  const hottest = months.filter((m) => m.rank != null && m.rank <= 3).sort((a, b) => a.rank - b.rank);
  const sessions = months.filter((m) => !m.partial).map((m) => m.sessions);
  return (
    <section className="card" aria-labelledby="calor-month-title">
      <div className="card-head">
        <h2 id="calor-month-title" className="card-title">Valor mensal negociado</h2>
        <span className="small muted">soma das sessões de cada mês · em euros</span>
      </div>
      {hottest.length > 0 && (
        <p className="small" style={{ margin: '0 0 0.5rem' }}>
          Meses mais quentes: {hottest.map((m, i) => (
            <span key={m.month}>{i > 0 && ', '}<strong>{monthLabel(m.month)}</strong> <span className="num">({bigMoney(m.value)})</span></span>
          ))}.
        </p>
      )}
      <div className="legend-chips" style={{ margin: '0.5rem 0 0.25rem' }}>
        {HEAT_LABELS.map((label, i) => (
          <span key={label} className="legend-chip static"><span className="swatch-box" style={{ background: `var(--heat-month-${i + 1})` }} />{label}</span>
        ))}
        <span className="legend-chip static"><span className="swatch-box" style={{ background: 'var(--heat-month-partial)' }} />Mês incompleto</span>
      </div>
      <Suspense fallback={<Loading rows={4} label="A carregar o gráfico…" />}>
        <MonthlyTurnoverChart months={months} />
      </Suspense>
      <p className="small muted" style={{ margin: '0.5rem 0 0' }}>
        A cor diz o quartil do mês entre os meses completos: «Muito quente» são os 25 % com mais valor negociado e «Frio» os 25 % com menos.{' '}
        {sessions.length > 0 && <>Os meses completos têm entre {Math.min(...sessions)} e {Math.max(...sessions)} sessões; a média por sessão está na tabela.</>}
      </p>
      <details style={{ marginTop: '0.75rem' }}>
        <summary className="small">Ver os dados</summary>
        <div className="table-wrap" tabIndex={0} aria-label="Valor negociado por mês">
          <table className="data">
            <thead><tr><th scope="col">Mês</th><th scope="col" className="r">Valor negociado</th><th scope="col" className="r">Sessões</th><th scope="col" className="r">Média por sessão</th><th scope="col">Calor</th></tr></thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthLabel(m.month)}</th>
                  <td className="r num">{bigMoney(m.value)}</td>
                  <td className="r num">{m.sessions}</td>
                  <td className="r num">{bigMoney(m.perSession)}</td>
                  <td>{m.partial ? <span className="muted">incompleto</span> : <>{HEAT_LABELS[m.heat - 1]} <span className="small muted">({m.rank}.º)</span></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

/** Capitalização Mercado: soma de fecho × número de acções de cada instrumento, com a SMA200. */
function MarketCapSection() {
  const q = useQuery({ queryKey: ['market', 'cap'], queryFn: () => api.get('/market/cap'), staleTime: 10 * 60_000 });
  const points = q.data?.points ?? [];
  const s = q.data?.summary;
  const cov = q.data?.coverage;
  const peak = useMemo(() => peakSession(q.data?.points ?? []), [q.data]);
  const first = points[0];
  return (
    <section className="card" aria-labelledby="calor-cap-title">
      <div className="card-head">
        <h2 id="calor-cap-title" className="card-title">Capitalização Mercado</h2>
        {points.length > 0 && <span className="small muted">{f.date(points[0].date)} a {f.date(points.at(-1).date)} · em euros</span>}
      </div>
      {q.isPending ? <Loading rows={6} label="A somar a capitalização de todos os instrumentos…" />
        : q.error ? <ErrorState error={q.error} onRetry={q.refetch} />
          : points.length === 0 ? <p className="small muted">Ainda não há cotações com número de acções.</p>
            : (
              <>
                {s && (
                  <div className="calor-stats">
                    <Stat label="Última sessão completa" value={bigMoney(s.value)} sub={f.date(s.date)} />
                    <Stat label="Média de 200 sessões" value={bigMoney(s.sma200)} />
                    <Stat label="Face à média" value={signedPctOf(s.vsSma200)}
                      sub={s.vsSma200 == null ? null : s.vsSma200 >= 0 ? 'acima da média' : 'abaixo da média'} />
                    {first && <Stat label="Variação na janela" value={signedPctOf(s.value / first.value - 1)} sub={`desde ${f.date(first.date)}`} />}
                    {peak && <Stat label="Máximo da janela" value={bigMoney(peak.value)} sub={f.date(peak.date)} />}
                    {q.data.partial && (
                      <Stat label="Sessão em curso" value={bigMoney(q.data.partial.value)}
                        sub={`${f.date(q.data.partial.date)} · provisório, fora do gráfico`} />
                    )}
                  </div>
                )}
                <div className="legend-chips" style={{ margin: '0.75rem 0 0.25rem' }}>
                  <span className="legend-chip static"><span className="swatch" style={{ background: 'var(--series-price)' }} />Capitalização</span>
                  <span className="legend-chip static"><span className="swatch" style={{ background: 'var(--series-sma200)' }} />SMA200</span>
                </div>
                <Suspense fallback={<Loading rows={4} label="A carregar o gráfico…" />}>
                  <TurnoverChart points={points} label="capitalização" countLabel="instrumentos" zeroBased={false} />
                </Suspense>
              </>
            )}
      <p className="small muted" style={{ margin: '0.75rem 0 0' }}>
        Capitalização de cada instrumento = fecho × número de acções. O número de acções é o actual (Yahoo Finance), aplicado
        a todo o período: emissões e recompras de acções não são reconstituídas. Em empresas com duas classes de acções o Yahoo
        conta, por vezes, só uma, e as holdings cotadas (ex.: Heineken Holding) somam-se à participada.
        {cov && cov.withShares < cov.total && <> Sem número de acções: {cov.total - cov.withShares} de {cov.total} instrumentos, fora da soma.</>}
        {' '}O eixo não começa em zero, para se verem as variações.
      </p>
    </section>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div>
      <p className="stat-label">{label}</p>
      <p className="num" style={{ margin: 0, fontWeight: 600, fontSize: '1.125rem' }}>{value}</p>
      {sub && <p className="small muted" style={{ margin: 0 }}>{sub}</p>}
    </div>
  );
}

/**
 * Calor: valor negociado diário de todo o catálogo nos últimos 2 anos, com a SMA200. O VN de cada instrumento é
 * volume × (abertura + mínimo + máximo + fecho) / 4; o do dia é a soma de todos os instrumentos activos.
 */
export default function CalorPage() {
  const q = useQuery({ queryKey: ['market', 'turnover'], queryFn: () => api.get('/market/turnover'), staleTime: 10 * 60_000 });
  const points = useMemo(() => q.data?.points ?? [], [q.data]);
  const partial = q.data?.partial;
  // A sessão em curso conta para o total do mês corrente (que já é um mês incompleto).
  const months = useMemo(() => monthlyTotals(partial ? [...points, partial] : points, { today: lisbonToday() }), [points, partial]);
  const peak = useMemo(() => peakSession(points), [points]);
  const s = q.data?.summary;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Calor</h1>
          <p className="page-sub">
            Quanto dinheiro mudou de mãos em cada sessão, somando todos os instrumentos do catálogo. Valor negociado de cada
            instrumento = volume × (abertura + mínimo + máximo + fecho) / 4. Acima da média de 200 sessões o mercado está mais
            «quente» do que o habitual; abaixo, mais «frio».
          </p>
        </div>
      </div>

      <div className="stack">
      <MarketCapSection />
      <section className="card" aria-labelledby="calor-title">
        <div className="card-head">
          <h2 id="calor-title" className="card-title">Valor negociado diário (2 anos)</h2>
          {points.length > 0 && <span className="small muted">{f.date(points[0].date)} a {f.date(points.at(-1).date)} · em euros</span>}
        </div>
        {q.isPending ? <Loading rows={6} label="A somar o valor negociado de todos os instrumentos…" />
          : q.error ? <ErrorState error={q.error} onRetry={q.refetch} />
            : points.length === 0 ? <p className="small muted">Ainda não há cotações.</p>
              : (
                <>
                  {s && (
                    <div className="calor-stats">
                      <Stat label="Última sessão completa" value={bigMoney(s.value)} sub={f.date(s.date)} />
                      <Stat label="Média de 200 sessões" value={bigMoney(s.sma200)} />
                      <Stat label="Face à média" value={signedPctOf(s.vsSma200)}
                        sub={s.vsSma200 == null ? null : s.vsSma200 >= 0 ? 'mais quente do que o habitual' : 'mais frio do que o habitual'} />
                      {peak && <Stat label="Máximo da janela" value={bigMoney(peak.value)} sub={f.date(peak.date)} />}
                      {q.data.partial && (
                        <Stat label="Sessão em curso" value={bigMoney(q.data.partial.value)}
                          sub={`${f.date(q.data.partial.date)} · parcial, fora do gráfico`} />
                      )}
                    </div>
                  )}
                  <div className="legend-chips" style={{ margin: '0.75rem 0 0.25rem' }}>
                    <span className="legend-chip static"><span className="swatch" style={{ background: 'var(--series-price)' }} />Valor negociado</span>
                    <span className="legend-chip static"><span className="swatch" style={{ background: 'var(--series-sma200)' }} />SMA200</span>
                  </div>
                  <Suspense fallback={<Loading rows={4} label="A carregar o gráfico…" />}>
                    <TurnoverChart points={points} />
                  </Suspense>
                </>
              )}
        <p className="small muted" style={{ margin: '0.75rem 0 0' }}>
          Preços reais (não ajustados) e volumes do Yahoo Finance, de todos os instrumentos activos. Dias com menos bolsas abertas
          (24 e 31 de dezembro, feriados locais) aparecem mais baixos; o número de instrumentos com negócios está na caixa de cada dia.
        </p>
      </section>

      {months.length > 0 && <MonthlySection months={months} />}

      </div>
    </>
  );
}
