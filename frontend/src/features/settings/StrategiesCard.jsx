import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import { STRATEGIES } from '../../lib/strategy.js';
import { useStrategies } from '../../lib/queries.js';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Notice, Switch } from '../../components/ui/controls.jsx';

/**
 * Estratégias (administradores): liga e desliga cada estratégia para todos os módulos. Uma estratégia desligada deixa de
 * aparecer e de contar em Acompanhar (melhor estratégia), Sinais, BackTest, Comparar, WinnersLoosers, Charts e Visão geral,
 * e a Automação não a executa. Tem de ficar pelo menos uma ligada.
 */
export default function StrategiesCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const strategies = useStrategies();
  const toggle = useMutation({
    mutationFn: ({ id, enabled }) => api.put(`/strategies/${id}/enabled`, { enabled }),
    onSuccess: (_, { id, enabled }) => {
      toast(`${STRATEGIES.find((s) => s.id === id)?.name} ${enabled ? 'ligada' : 'desligada'}`);
      // Todos os resultados dependem das estratégias ligadas: actualizam-se todos (os pedidos só se repetem nas páginas abertas).
      qc.invalidateQueries();
    },
  });
  const on = strategies.ids;
  const onlyOne = on != null && on.size <= 1;

  return (
    <section className="card" aria-labelledby="strategies-title">
      <h2 id="strategies-title" className="card-title" style={{ marginBottom: '0.5rem' }}>Estratégias</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Liga ou desliga cada estratégia em todos os módulos. Uma estratégia desligada deixa de aparecer e de contar em Acompanhar (melhor
        estratégia), Sinais, BackTest, Comparar, WinnersLoosers, Charts e Visão geral, e a Automação não a executa. Tem de ficar pelo menos
        uma ligada. As Promessas e as análises semanais continuam a usar as estratégias de sempre.
      </p>
      {toggle.error && <Notice tone="error">{errorMessage(toggle.error)}</Notice>}
      <ul className="automation-strategies">
        {STRATEGIES.filter((s) => s.available).map((s) => {
          const enabled = strategies.isEnabled(s.id);
          return (
            <li key={s.id} className="spread">
              <div>
                <strong>{s.name}</strong>{s.budget != null && <span className="small muted"> · {s.budget.toLocaleString('pt-PT')} € por compra</span>}
                <div className="small muted">{s.summary}</div>
              </div>
              <Switch label={`Estratégia ${s.name}`} checked={enabled} disabled={toggle.isPending || (enabled && onlyOne)}
                onChange={(v) => toggle.mutate({ id: s.id, enabled: v })} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
