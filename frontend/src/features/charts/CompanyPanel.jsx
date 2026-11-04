import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { bigMoney, pctOf, rangePosition, ratio, shortSummary } from '../../lib/company.js';
import { Loading } from '../../components/feedback/states.jsx';

const FinancialsChart = lazy(() => import('../../components/finance/FinancialsChart.jsx'));

/**
 * Painel «Empresa» do Charts: actividade, sector, indicadores e contas anuais (fonte: Yahoo Finance, recolhido uma vez por
 * semana). A descrição vem em inglês, tal como o Yahoo a dá.
 */
export default function CompanyPanel({ instrumentId, lastPrice }) {
  const q = useQuery({
    queryKey: ['company-profile', instrumentId], queryFn: () => api.get(`/instruments/${instrumentId}/profile`),
    staleTime: 60 * 60_000, enabled: Boolean(instrumentId),
  });
  const [expanded, setExpanded] = useState(false);
  const p = q.data?.profile;

  if (q.isPending) return <section className="company-panel" aria-label="Empresa"><Loading rows={3} label="A carregar o perfil da empresa…" /></section>;
  if (q.error || !p) {
    return (
      <section className="company-panel" aria-labelledby="company-title">
        <h2 id="company-title" className="card-title">Empresa</h2>
        <p className="small muted">{q.error ? 'Não foi possível carregar o perfil da empresa.' : 'Ainda não há perfil desta empresa: é recolhido uma vez por semana (e quando o instrumento é adicionado).'}</p>
      </section>
    );
  }

  const cur = p.financialCurrency || p.currency || 'EUR';
  const summary = shortSummary(p.summary);
  const pos = rangePosition(lastPrice, p.low52w, p.high52w);
  const where = [p.city, p.country].filter(Boolean).join(', ');
  const metrics = [
    ['Capitalização', bigMoney(p.marketCap, p.currency || 'EUR')],
    ['P/E (12 meses)', ratio(p.trailingPe, { negativeIsNa: true })],
    ['P/E (estimado)', ratio(p.forwardPe, { negativeIsNa: true })],
    ['Preço / valor contabilístico', ratio(p.priceToBook)],
    ['Dividendo (rendimento)', pctOf(p.dividendYield, { fraction: false })],
    ['Resultado por acção', p.eps == null ? '—' : f.price(p.eps, p.currency || 'EUR')],
    ['Margem líquida', pctOf(p.profitMargin)],
    ['Rentabilidade dos capitais próprios', pctOf(p.returnOnEquity)],
    ['Dívida / capitais próprios', pctOf(p.debtToEquity, { fraction: false, digits: 0 })],
    ['Beta', ratio(p.beta)],
  ];
  const years = p.financials ?? [];

  return (
    <section className="company-panel" aria-labelledby="company-title">
      <div className="spread">
        <h2 id="company-title" className="card-title">Empresa</h2>
        <span className="small muted">Fonte: Yahoo Finance{q.data.fetchedAt ? ` · ${f.date(q.data.fetchedAt.slice(0, 10))}` : ''}</span>
      </div>
      <p style={{ margin: '0.25rem 0' }}>
        <strong>{p.longName}</strong>
        {(p.sector || p.industry) && <span className="muted"> · {[p.sector, p.industry].filter(Boolean).join(' — ')}</span>}
      </p>
      <p className="small muted" style={{ margin: 0 }}>
        {[where, p.employees ? `${f.number(p.employees)} trabalhadores` : null].filter(Boolean).join(' · ')}
        {p.website && <>{where || p.employees ? ' · ' : ''}<a href={p.website} target="_blank" rel="noopener noreferrer">{p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></>}
      </p>

      {p.summary && (
        <div className="company-summary">
          <p lang="en" className="small" style={{ margin: 0 }}>{expanded ? p.summary : summary.text}</p>
          {summary.cut && (
            <button type="button" className="link-button small" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? 'Mostrar menos' : 'Mostrar tudo'}
            </button>
          )}
          <span className="small muted"> (descrição em inglês)</span>
        </div>
      )}

      <dl className="company-metrics">
        {metrics.map(([k, v]) => <div key={k}><dt className="small muted">{k}</dt><dd className="num">{v}</dd></div>)}
        {p.low52w != null && p.high52w != null && (
          <div className="company-range">
            <dt className="small muted">Intervalo de 52 semanas</dt>
            <dd>
              <span className="num">{f.price(p.low52w, p.currency || 'EUR')} – {f.price(p.high52w, p.currency || 'EUR')}</span>
              {pos != null && (
                <span className="range-bar" role="img" aria-label={`Último preço a ${Math.round(pos * 100)} % do intervalo`}>
                  <span className="range-dot" style={{ left: `${pos * 100}%` }} />
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {years.length > 0 && (
        <>
          <h3 className="small" style={{ margin: '1rem 0 0.25rem' }}>Contas anuais ({cur})</h3>
          <Suspense fallback={<Loading rows={2} label="A carregar…" />}>
            <FinancialsChart financials={years} currency={cur} />
          </Suspense>
          <table className="visually-hidden">
            <caption>Contas anuais em {cur}</caption>
            <thead><tr><th scope="col">Ano</th><th scope="col">Receitas</th><th scope="col">Resultado operacional</th><th scope="col">Resultado líquido</th><th scope="col">EBITDA</th></tr></thead>
            <tbody>
              {years.map((r) => (
                <tr key={r.year}><th scope="row">{r.year}</th><td>{bigMoney(r.revenue, cur)}</td><td>{bigMoney(r.operatingIncome, cur)}</td><td>{bigMoney(r.netIncome, cur)}</td><td>{bigMoney(r.ebitda, cur)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>Informação de terceiros, só para contexto; não é uma recomendação de investimento.</p>
    </section>
  );
}
