import { lazy, Suspense, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { bigMoney, signedPctOf } from '../../lib/company.js';
import { monthLabel, monthlyAverages, peakSession } from '../../lib/turnover.js';
import { ErrorState, Loading } from '../../components/feedback/states.jsx';

const TurnoverChart = lazy(() => import('../../components/finance/TurnoverChart.jsx'));

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
  const months = useMemo(() => monthlyAverages(points), [points]);
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
                  <details style={{ marginTop: '0.75rem' }}>
                    <summary className="small">Ver os dados (médias mensais)</summary>
                    <div className="table-wrap" tabIndex={0} aria-label="Médias mensais do valor negociado">
                      <table className="data">
                        <thead><tr><th scope="col">Mês</th><th scope="col" className="r">Valor negociado médio</th><th scope="col" className="r">SMA200 média</th><th scope="col" className="r">Sessões</th></tr></thead>
                        <tbody>
                          {[...months].reverse().map((m) => (
                            <tr key={m.month}>
                              <th scope="row">{monthLabel(m.month)}</th>
                              <td className="r num">{bigMoney(m.value)}</td>
                              <td className="r num">{bigMoney(m.sma200)}</td>
                              <td className="r num">{m.sessions}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
        <p className="small muted" style={{ margin: '0.75rem 0 0' }}>
          Preços reais (não ajustados) e volumes do Yahoo Finance, de todos os instrumentos activos. Dias com menos bolsas abertas
          (24 e 31 de dezembro, feriados locais) aparecem mais baixos; o número de instrumentos com negócios está na caixa de cada dia.
        </p>
      </section>
    </>
  );
}
