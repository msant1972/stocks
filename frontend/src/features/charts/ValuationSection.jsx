import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import {
  metricValue, peerPosition, pctOf, RECOMMENDATION, signedPctOf, VERDICT, verdictSentence,
} from '../../lib/company.js';
import { Loading } from '../../components/feedback/states.jsx';

const PeHistoryChart = lazy(() => import('../../components/finance/PeHistoryChart.jsx'));

const nf1 = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const x = (v) => (v == null ? '—' : `${nf1.format(v)}×`);

function Badge({ verdict }) {
  if (!verdict) return <span className="badge">Sem dados</span>;
  const v = VERDICT[verdict];
  return <span className={`badge ${v.badge}`}>{v.label}</span>;
}

function Criterion({ title, verdict, children }) {
  return (
    <article className="valuation-card">
      <header className="spread"><h4 className="small" style={{ margin: 0 }}>{title}</h4><Badge verdict={verdict} /></header>
      {children}
    </article>
  );
}

/** Barra de posição (0 = mais barato, 1 = mais caro) com etiquetas nas pontas. */
function PositionBar({ position, label }) {
  return (
    <span className="range-bar" role="img" aria-label={label}>
      <span className="range-dot" style={{ left: `${Math.min(1, Math.max(0, position)) * 100}%` }} />
    </span>
  );
}

const HISTORY_REASON = {
  currency: 'As contas estão noutra moeda; não se calcula o P/E histórico.',
  'no-eps': 'O Yahoo não tem o resultado por acção anual desta empresa.',
  short: 'Há menos de um ano de P/E positivo para comparar.',
};

/**
 * Secção «Valorização» do painel Empresa: quatro critérios com veredicto (sector, história do P/E, analistas, Graham),
 * o DCF invertido (só informativo) e o veredicto global por maioria. Calculada pela API com o último fecho.
 */
export default function ValuationSection({ instrumentId }) {
  const q = useQuery({
    queryKey: ['company-valuation', instrumentId], queryFn: () => api.get(`/instruments/${instrumentId}/valuation`),
    staleTime: 15 * 60_000, enabled: Boolean(instrumentId),
  });
  if (q.isPending) return <Loading rows={2} label="A calcular a valorização…" />;
  const v = q.data?.valuation;
  if (q.error || !v) {
    return (
      <section aria-labelledby="valuation-title">
        <h3 id="valuation-title" className="small" style={{ margin: '1rem 0 0.25rem' }}>Valorização</h3>
        <p className="small muted">{q.error ? 'Não foi possível calcular a valorização.' : 'Sem dados suficientes para a valorização.'}</p>
      </section>
    );
  }
  const cur = v.currency || 'EUR';
  const { sector, history, analysts, graham, dcf } = v;
  const overall = VERDICT[v.summary.verdict];

  return (
    <section aria-labelledby="valuation-title" className="valuation">
      <div className="spread" style={{ margin: '1rem 0 0.25rem' }}>
        <h3 id="valuation-title" className="small" style={{ margin: 0 }}>Valorização</h3>
        <span className="small muted">Último preço ({f.date(v.priceDate)}): {f.price(v.price, cur)}</span>
      </div>
      <p style={{ margin: '0 0 0.75rem' }}>
        <span className={`badge ${overall.badge}`} style={{ fontSize: '0.9375rem' }}>{overall.label}</span>{' '}
        <span className="small">{verdictSentence(v.summary)}</span>
      </p>

      <div className="valuation-grid">
        <Criterion title={`Face ao sector${sector.sector ? ` (${sector.sector})` : ''}`} verdict={sector.verdict}>
          {sector.metrics.length === 0 ? (
            <p className="small muted">Há poucas empresas do mesmo sector com dados para comparar.</p>
          ) : (
            <ul className="valuation-metrics">
              {sector.metrics.map((m) => (
                <li key={m.key}>
                  <div className="spread small">
                    <span>{m.label}</span>
                    <span className="num"><strong>{metricValue(m.key, m.value)}</strong> <span className="muted">· mediana {metricValue(m.key, m.sectorMedian)}</span></span>
                  </div>
                  <PositionBar position={1 - m.cheapness} label={`${m.label}: ${peerPosition(m.cheapness, m.peers)}`} />
                  <div className="small muted">{peerPosition(m.cheapness, m.peers)}</div>
                  {m.key === 'pe' && v.trailingEps != null && <div className="small muted">Com o resultado por acção de 12 meses ({f.price(v.trailingEps, cur)}).</div>}
                </li>
              ))}
            </ul>
          )}
          <p className="small muted" style={{ marginBottom: 0 }}>Na barra, à esquerda fica o mais barato do sector e à direita o mais caro.</p>
        </Criterion>

        <Criterion title="P/E face à própria história" verdict={history.verdict}>
          {history.verdict ? (
            <>
              <p className="small" style={{ margin: 0 }}>
                P/E actual <strong className="num">{x(history.current)}</strong>; desde {f.date(history.from)} a mediana foi{' '}
                <span className="num">{x(history.median)}</span> e a faixa habitual{' '}
                <span className="num">{x(history.p25)} – {x(history.p75)}</span>.
              </p>
              <Suspense fallback={<Loading rows={1} label="A carregar…" />}>
                <PeHistoryChart series={history.series} p25={history.p25} p75={history.p75} median={history.median} />
              </Suspense>
              <p className="small muted" style={{ marginBottom: 0 }}>
                Com o último resultado anual por acção conhecido em cada dia (agora {f.price(history.eps, cur)}, de {history.epsYear}). A faixa sombreada vai do 1.º ao 3.º quartil.
              </p>
            </>
          ) : <p className="small muted">{HISTORY_REASON[history.reason] ?? 'Sem dados.'}</p>}
        </Criterion>

        <Criterion title={`Analistas${analysts.count ? ` (${analysts.count})` : ''}`} verdict={analysts.verdict}>
          {analysts.verdict ? (
            <>
              <p className="small" style={{ margin: 0 }}>
                Preço-alvo médio <strong className="num">{f.price(analysts.mean, cur)}</strong>, ou seja{' '}
                <strong className="num">{signedPctOf(analysts.upside)}</strong> face ao fecho.
              </p>
              {analysts.low != null && analysts.high != null && analysts.high > analysts.low && (
                <>
                  <PositionBar position={(v.price - analysts.low) / (analysts.high - analysts.low)}
                    label={`Fecho dentro do intervalo de preços-alvo de ${f.price(analysts.low, cur)} a ${f.price(analysts.high, cur)}`} />
                  <div className="spread small muted"><span>mín. {f.price(analysts.low, cur)}</span><span>máx. {f.price(analysts.high, cur)}</span></div>
                </>
              )}
              {RECOMMENDATION[analysts.recommendation] && (
                <p className="small muted" style={{ marginBottom: 0 }}>Recomendação média: {RECOMMENDATION[analysts.recommendation]}.</p>
              )}
            </>
          ) : <p className="small muted">Menos de 3 analistas com preço-alvo.</p>}
        </Criterion>

        <Criterion title="Número de Graham" verdict={graham.verdict}>
          {graham.verdict ? (
            <>
              <p className="small" style={{ margin: 0 }}>
                Valor de referência <strong className="num">{f.price(graham.value, cur)}</strong>; o fecho está{' '}
                <strong className="num">{signedPctOf(graham.ratio - 1)}</strong> face a ele.
              </p>
              <p className="small muted" style={{ marginBottom: 0 }}>
                √(22,5 × resultado por acção de 12 meses ({f.price(graham.eps, cur)}) × valor contabilístico por acção ({f.price(graham.bookValue, cur)})). Pensado para empresas estáveis: penaliza as de crescimento rápido.
              </p>
            </>
          ) : <p className="small muted">Precisa de lucro e de capitais próprios positivos.</p>}
        </Criterion>
      </div>

      {dcf.impliedGrowth != null && (
        <p className="small" style={{ margin: '0.75rem 0 0' }}>
          <strong>DCF invertido</strong> <span className="muted">(informativo, não conta para o veredicto)</span>: o preço actual pressupõe que o
          fluxo de caixa livre cresça{' '}
          <strong className="num">{dcf.bound === 'below' ? 'menos de ' : dcf.bound === 'above' ? 'mais de ' : ''}{signedPctOf(dcf.impliedGrowth)}</strong>{' '}
          ao ano durante {dcf.assumptions.years} anos (desconto de {pctOf(dcf.assumptions.discount, { digits: 0 })}, {pctOf(dcf.assumptions.terminal, { digits: 0 })} depois).
          {dcf.revenueCagr != null && <> As receitas cresceram <span className="num">{signedPctOf(dcf.revenueCagr)}</span> ao ano nos últimos anos.</>}
        </p>
      )}
      <p className="small muted" style={{ margin: '0.5rem 0 0' }}>
        Valorização indicativa, calculada com dados do Yahoo Finance (actualizados uma vez por semana) e o último fecho. Não é uma recomendação de investimento.
      </p>
    </section>
  );
}
