import { Navigate, useParams, useSearchParams } from 'react-router';

/**
 * A página do instrumento passou para o Charts (gráfico, ações e lista num só sítio): as ligações antigas
 * /instrumentos/:id?estrategia=… continuam a funcionar e abrem o Charts nesse instrumento.
 */
export default function InstrumentRedirect() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const next = new URLSearchParams({ instrumento: id });
  if (params.get('estrategia')) next.set('estrategia', params.get('estrategia'));
  return <Navigate to={`/charts?${next}`} replace />;
}
