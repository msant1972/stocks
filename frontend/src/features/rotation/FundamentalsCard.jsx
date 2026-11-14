import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { ErrorState, Loading } from '../../components/feedback/states.jsx';

const pct1 = (v) => (v == null ? '—' : `${(v * 100).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const score = (v) => (v == null ? '—' : v.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * Valor e qualidade (fatores fundamentais): as empresas ordenadas pela média dos percentis de rendimento dos resultados, rendimento do
 * fluxo de caixa livre, ROE, margem líquida e baixa dívida. Informativo: só há os fundamentais de hoje, por isso não há simulação.
 */
export default function FundamentalsCard({ scope }) {
  const q = useQuery({ queryKey: ['fundamentals', scope], queryFn: () => api.get(`/strategies/fundamentals?scope=${scope}&limit=30`), staleTime: 10 * 60_000 });
  const d = q.data;
  return (
    <section className="card" aria-labelledby="fund-title">
      <h2 id="fund-title" className="card-title" style={{ marginBottom: '0.25rem' }}>Valor e qualidade</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        As 30 empresas com melhor pontuação de fundamentais: média dos percentis de rendimento dos resultados (1 / P/E), rendimento do fluxo de
        caixa livre, ROE, margem líquida e baixa dívida (mínimo de 4 indicadores). <strong>Só informativo, sem simulação</strong>: a base de dados só tem os
        fundamentais de hoje, e testá-los no passado usaria dados que ainda não se conheciam (viés de antecipação). «Também no momentum» marca as
        que estão no topo da rotação: valor e qualidade com preço a subir.
      </p>
      {q.isPending ? <Loading rows={4} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : d.items.length === 0 ? (
        <p className="small muted">Sem perfis de empresas com indicadores suficientes{scope === 'watchlist' ? ' na sua lista' : ''}.</p>
      ) : (
        <>
          <p className="small muted">{d.scored} de {d.universe} empresas com pontuação. Perfis recolhidos pelo Yahoo uma vez por semana.</p>
          <div className="table-wrap" tabIndex={0} aria-label="Empresas por valor e qualidade" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">#</th><th scope="col">Empresa</th><th scope="col" className="r">Pontuação</th><th scope="col" className="r">Valor</th><th scope="col" className="r">Qualidade</th>
                  <th scope="col" className="r">Rend. resultados</th><th scope="col" className="r">Rend. FCF</th><th scope="col" className="r">ROE</th><th scope="col" className="r">Margem</th><th scope="col">Momentum</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((x) => (
                  <tr key={x.instrumentId}>
                    <td className="r">{x.rank}</td>
                    <td><Link to={`/charts?instrumento=${x.instrumentId}`} className="row-link">{x.symbol}</Link><div className="small muted">{x.name}{x.sector ? ` · ${x.sector}` : ''}</div></td>
                    <td className="r num">{score(x.score)}</td>
                    <td className="r num">{score(x.value)}</td>
                    <td className="r num">{score(x.quality)}</td>
                    <td className="r num">{pct1(x.earningsYield)}</td>
                    <td className="r num">{pct1(x.fcfYield)}</td>
                    <td className="r num">{pct1(x.roe)}</td>
                    <td className="r num">{pct1(x.margin)}</td>
                    <td>{x.inMomentum ? <span className="badge badge-positive">também no momentum</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
