import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { AUTOMATION_STATUS, automationRunText, automationState, splitAutomationItems } from '../../lib/saxo.js';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Notice, Switch } from '../../components/ui/controls.jsx';
import { SIM_BANNER, useSaxoStatus } from './SaxoOrderDialog.jsx';

const SIDE = { buy: 'Compra', add: 'Reforço', sell: 'Venda' };

const STATE = {
  filled: { label: 'executada', tone: 'badge-positive' }, pending: { label: 'à espera', tone: '' },
  missed: { label: 'não executada', tone: 'badge-warning' }, unknown: { label: 'por confirmar', tone: 'badge-warning' },
};
const signedPct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`);

/**
 * Automação face ao BackTest: o preço a que a SAXO executou cada ordem contra o preço que o BackTest assume (o fecho da
 * sessão do sinal na A-Momentum; a abertura, ou o stop, nas restantes), e as ordens que não chegaram a ser executadas.
 */
function Comparison() {
  const q = useQuery({ queryKey: ['saxo-automation-comparison'], queryFn: () => api.get('/saxo/automation/comparison'), staleTime: 60_000 });
  const d = q.data;
  return (
    <section className="card" aria-labelledby="auto-cmp-title">
      <div className="card-head">
        <h2 id="auto-cmp-title" className="card-title">Automação face ao BackTest</h2>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Quanto a execução real se afasta do que o BackTest assume. Desvio positivo = pior do que o BackTest (compra mais cara ou venda mais
        barata). As ordens não executadas (compras limitadas que expiraram, por exemplo) são operações que o BackTest conta e a conta não fez.
      </p>
      {q.isPending ? <Loading rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : d.summary.sent === 0 ? (
        <EmptyState title="Ainda sem ordens para comparar">
          Ligue a automação numa estratégia; cada ordem enviada aparece aqui com o preço executado ao lado do preço do BackTest.
        </EmptyState>
      ) : (
        <>
          <dl className="kpis">
            <div><dt>Ordens enviadas</dt><dd>{d.summary.sent}</dd></div>
            <div><dt>Executadas</dt><dd>{d.summary.fillRatePct == null ? '—' : `${d.summary.fillRatePct.toLocaleString('pt-PT')} %`}</dd></div>
            <div><dt>Desvio médio do preço</dt><dd>{signedPct(d.summary.deviationPct)}</dd></div>
            <div><dt>Efeito no resultado</dt><dd>{d.summary.measured ? f.signedMoney(-d.summary.effect) : '—'}</dd></div>
          </dl>
          <p className="small muted" style={{ margin: '0.5rem 0 0.75rem' }}>
            {d.summary.filled} executadas, {d.summary.missed} não executadas, {d.summary.pending} à espera{d.summary.unknown ? `, ${d.summary.unknown} por confirmar` : ''}.
            O desvio médio é pesado pelo valor das {d.summary.measured} ordens executadas com preço do BackTest conhecido (o fecho da A-Momentum
            só se conhece depois do fecho da sessão).
          </p>
          <div className="table-wrap" tabIndex={0} aria-label="Ordens da automação face ao BackTest">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Sinal</th><th scope="col">Estratégia</th><th scope="col">Instrumento</th><th scope="col">Ordem</th>
                  <th scope="col" className="r">BackTest</th><th scope="col" className="r">Executado</th><th scope="col" className="r">Desvio</th><th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id}>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{f.date(i.signalDate)}</td>
                    <td>{i.strategyName}<div className="small muted">{i.execution === 'close' ? 'ao fecho' : 'na abertura'}</div></td>
                    <td><Link to={`/instrumentos/${i.instrumentId}`} className="row-link">{i.symbol}</Link></td>
                    <td>{i.side === 'buy' ? 'Compra' : 'Venda'} <span className="num">{f.quantity(i.quantity)}</span></td>
                    <td className="r num">{i.expectedPrice == null ? <span className="muted">—</span> : f.price(i.expectedPrice)}</td>
                    <td className="r num">{i.fillPrice == null ? <span className="muted">—</span> : f.price(i.fillPrice)}</td>
                    <td className="r num">{signedPct(i.deviationPct)}</td>
                    <td><span className={`badge ${STATE[i.state].tone}`}>{STATE[i.state].label}</span></td>
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

/**
 * Automação: lê os sinais das estratégias ligadas e envia as ordens à conta de simulação da SAXO, sem confirmação.
 * Interruptor geral (desligado por omissão), um por estratégia e a lista das ordens com o estado real na SAXO.
 */
export default function SaxoAutomationPage() {
  const qc = useQueryClient();
  const token = useSaxoStatus();
  const status = useQuery({ queryKey: ['saxo-automation'], queryFn: () => api.get('/saxo/automation') });
  const orders = useQuery({
    queryKey: ['saxo-automation-orders'], queryFn: () => api.get('/saxo/automation/orders'),
    // Enquanto houver ordens à espera, a vigia da API actualiza o estado a cada minuto.
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.order?.status === 'working') ? 30_000 : false),
  });
  const setStatus = (data) => qc.setQueryData(['saxo-automation'], data);
  const toggleAll = useMutation({ mutationFn: (enabled) => api.put('/saxo/automation', { enabled }), onSuccess: setStatus });
  const toggleOne = useMutation({ mutationFn: ({ id, enabled }) => api.put(`/saxo/automation/strategies/${id}`, { enabled }), onSuccess: setStatus });
  const s = status.data;
  const { sent, notSent } = splitAutomationItems(orders.data?.items ?? []);
  const anyStrategy = s?.strategies.some((x) => x.enabled);
  const saxoOk = token.data?.configured && !token.data?.expired;
  const failure = toggleAll.error ?? toggleOne.error;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Automação</h1>
          <p className="page-sub">
            Lê os sinais das estratégias ligadas e envia as ordens à SAXO Bank sem pedir confirmação, de hora a hora nos dias úteis, 3 minutos
            depois de começar cada recolha do Yahoo (recolhas das 08:20 às 16:20, execuções das 08:23 às 16:23 de Lisboa; as ordens só se enviam até às 16:35,
            e o que ficar de fora segue às 08:23 da sessão seguinte), com os sinais da sessão em curso e da última sessão. Só actua nos instrumentos da
            minha lista, cada um pela sua melhor estratégia (as vendas valem sempre). Compras limitadas ao último preço + 1 %, vendas a mercado; todas as ordens são válidas por 1 dia.
          </p>
        </div>
      </div>
      <Notice tone="warning">{SIM_BANNER}</Notice>
      {token.data && !token.data.configured && <Notice tone="info">Ainda não está ligado à SAXO Bank: sem ligação, a automação não envia ordens. <Link to="/definicoes">Ligar em Definições</Link></Notice>}
      {token.data?.expired && <Notice tone="warning">A ligação à SAXO Bank expirou: a automação não envia ordens até voltar a ligar. <Link to="/definicoes">Abrir Definições</Link></Notice>}
      {failure && <Notice tone="error">{errorMessage(failure)}</Notice>}

      {status.isPending ? <Loading rows={3} /> : status.error ? <ErrorState error={status.error} onRetry={status.refetch} /> : (
        <div className="grid">
          <section className="card span-12 xl-span-4" style={{ alignSelf: 'start' }} aria-labelledby="auto-enable-title">
            <div className="spread">
              <div>
                <h2 id="auto-enable-title" className="card-title">Enable</h2>
                <p className="small muted" style={{ margin: 0 }}>
                  {!s.enabled ? 'Desligada: nenhuma ordem é enviada automaticamente.'
                    : !anyStrategy ? 'Ligada, mas sem nenhuma estratégia ligada: nenhuma ordem é enviada.'
                      : saxoOk ? 'Ligada: as estratégias ligadas enviam ordens de hora a hora, das 08:23 às 16:23 dos dias úteis (ordens até às 16:35).' : 'Ligada, mas sem ligação válida à SAXO Bank.'}
                </p>
              </div>
              <Switch label="Ligar ou desligar a automação" checked={s.enabled} disabled={toggleAll.isPending} onChange={(v) => toggleAll.mutate(v)} />
            </div>
            {s.lastRun && (
              <p className="small muted" style={{ margin: '0.75rem 0 0' }} aria-live="polite">
                Última execução ({f.dateTime(s.lastRun.startedAt)}): {automationRunText(s.lastRun)}
              </p>
            )}
          </section>

          <section className="card span-12 xl-span-8" aria-labelledby="auto-strategies-title">
            <h2 id="auto-strategies-title" className="card-title">Estratégias</h2>
            <ul className="automation-strategies">
              {s.strategies.map((x) => (
                <li key={x.id} className="spread">
                  <div>
                    <strong>{x.name}</strong>{x.disabledInSettings && <span className="badge badge-warning" style={{ marginLeft: 8 }}>desligada nas Definições</span>}{x.budget != null && <span className="small muted"> · {f.money(x.budget, 'EUR', 0)} por compra</span>}
                    {x.summary && <div className="small muted">{x.summary}</div>}
                  </div>
                  <Switch label={`Automação da estratégia ${x.name}`} checked={x.enabled} disabled={toggleOne.isPending || x.disabledInSettings} onChange={(enabled) => toggleOne.mutate({ id: x.id, enabled })} />
                </li>
              ))}
            </ul>
            <p className="small muted" style={{ margin: '0.75rem 0 0' }}>
              Os sinais da sessão em curso são calculados com os últimos dados e podem desaparecer até ao fecho; a ordem enviada fica.
              As vendas só vendem o que a automação comprou para essa estratégia: posições manuais ou de outra estratégia não são tocadas.
              Duas estratégias ligadas podem comprar o mesmo instrumento, com o orçamento de cada uma.
            </p>
          </section>
        </div>
      )}

      <section className="card" aria-labelledby="auto-orders-title">
        <h2 id="auto-orders-title" className="card-title">Ordens enviadas</h2>
        {orders.isPending ? <Loading rows={4} /> : orders.error ? <ErrorState error={orders.error} onRetry={orders.refetch} /> : sent.length === 0 ? (
          <EmptyState title="Sem ordens">A automação ainda não enviou nenhuma ordem à SAXO.</EmptyState>
        ) : (
          <div className="table-wrap" tabIndex={0} aria-label="Ordens enviadas pela automação">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Enviada</th><th scope="col">Estratégia</th><th scope="col">Instrumento</th><th scope="col">Ordem</th>
                  <th scope="col" className="r">Quantidade</th><th scope="col" className="r">Preço</th><th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {sent.map((i) => {
                  const st = AUTOMATION_STATUS[i.order.status] ?? AUTOMATION_STATUS.unknown;
                  return (
                    <tr key={i.id}>
                      <td className="small" style={{ whiteSpace: 'nowrap' }}>{f.dateTime(i.createdAt)}<div className="muted">sinal de {f.date(i.signalDate)}</div></td>
                      <td>{i.strategyName}</td>
                      <td><Link to={`/instrumentos/${i.instrumentId}`} className="row-link">{i.symbol}</Link></td>
                      <td>{SIDE[i.signalSide]}<div className="small muted">{i.order.orderType === 'limit' ? 'limitada' : 'a mercado'}</div></td>
                      <td className="r num">{f.quantity(i.order.quantity)}</td>
                      <td className="r num">{i.order.limitPrice ? f.price(i.order.limitPrice) : '—'}</td>
                      <td>
                        <span className={`badge ${st.tone}`}>{st.label}</span>
                        {automationState(i) && <div className="small muted">{automationState(i)}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {notSent.length > 0 && (
          <details style={{ marginTop: '0.75rem' }}>
            <summary className="small">Sinais não enviados ({notSent.length})</summary>
            <ul className="small" style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
              {notSent.map((i) => <li key={i.id}>{f.date(i.signalDate)} · {i.strategyName} · {SIDE[i.signalSide]} de {i.symbol}: <span className="muted">{i.message}</span></li>)}
            </ul>
          </details>
        )}
      </section>
      <Comparison />
    </>
  );
}
