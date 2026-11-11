import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { keys, useAlerts } from '../../lib/queries.js';
import { heldBySaxo } from '../../lib/saxo.js';
import { DEFAULT_STRATEGY_ID, getStrategy } from '../../lib/strategy.js';
import StrategySelect from '../../components/finance/StrategySelect.jsx';
import { PriceChange } from '../../components/finance/finance.jsx';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Button, Field, Notice, Segmented } from '../../components/ui/controls.jsx';
import SaxoOrderDialog, { useSaxoStatus } from '../saxo/SaxoOrderDialog.jsx';
import SaxoBatchDialog from '../saxo/SaxoBatchDialog.jsx';

const SIDES = {
  buy: { label: 'Compra', letter: 'C', cls: 'badge-positive' },
  add: { label: 'Reforço', letter: 'R', cls: 'badge-accent' },
  sell: { label: 'Venda', letter: 'V', cls: 'badge-negative' },
};
const PERIODS = ['1', '3', '5', '10'];

/** Sinais de uma estratégia do registo aplicada virtualmente a todos os instrumentos. */
export default function SignalsPage() {
  const [params, setParams] = useSearchParams();
  const strategyId = getStrategy(params.get('estrategia')) ? params.get('estrategia') : DEFAULT_STRATEGY_ID;
  const strategy = getStrategy(strategyId);
  const budget = strategy.budget;
  const side = ['buy', 'add', 'sell'].includes(params.get('tipo')) ? params.get('tipo') : 'all';
  const sessions = PERIODS.includes(params.get('sessoes')) ? params.get('sessoes') : '5';
  const [saxoTrade, setSaxoTrade] = useState(null); // { instrument, side, quantity }
  const [saxoBatch, setSaxoBatch] = useState(false);
  const saxo = useSaxoStatus();
  const saxoLinked = Boolean(saxo.data?.configured && !saxo.data?.expired);
  const saxoPortfolio = useQuery({ queryKey: ['saxo-portfolio'], queryFn: () => api.get('/saxo/portfolio'), enabled: saxoLinked, retry: false, refetchOnWindowFocus: false });
  const alerts = useAlerts();
  const qc = useQueryClient();
  const toast = useToast();
  const [alertBusy, setAlertBusy] = useState(null);
  const [alertError, setAlertError] = useState(null);
  // Instrumentos que já têm um alerta de sinal desta estratégia.
  const alerted = new Set((alerts.data?.items ?? []).filter((r) => r.kind === 'signal' && r.strategy === strategyId).map((r) => r.instrumentId));

  /** Cria o alerta de sinal da estratégia escolhida neste instrumento (o email chega no resumo após a recolha diária). */
  async function notifyMe(i) {
    setAlertBusy(i.instrumentId);
    setAlertError(null);
    try {
      await api.post('/alerts', { instrumentId: i.instrumentId, kind: 'signal', strategy: strategyId });
      await qc.invalidateQueries({ queryKey: keys.alerts });
      toast(`Alerta criado: sinais da ${strategy.name} em ${i.symbol}`);
    } catch (err) {
      setAlertError(errorMessage(err));
    } finally {
      setAlertBusy(null);
    }
  }
  const q = useQuery({
    queryKey: ['signals', strategyId, sessions, 'watchlist'],
    queryFn: () => api.get(`/signals?strategy=${strategyId}&sessions=${sessions}&scope=watchlist`),
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  });

  const setParam = (key, value, fallback) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  const held = heldBySaxo(saxoPortfolio.data?.positions);
  const all = q.data?.items ?? [];
  const items = side === 'all' ? all : all.filter((i) => i.side === side);
  const count = (s) => all.filter((i) => i.side === s).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Sinais</h1>
          <p className="page-sub">Compras, reforços e vendas da estratégia {strategy.name} aplicada virtualmente aos instrumentos da minha lista{q.data?.instruments != null ? ` (${q.data.instruments})` : ''}.</p>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Link className="button mobile-only-inline" to="/backtest">BackTest</Link>
          <StrategySelect value={strategyId} onChange={(id) => setParam('estrategia', id, DEFAULT_STRATEGY_ID)} />
          <Segmented label="Tipo de sinal" value={side} onChange={(v) => setParam('tipo', v, 'all')}
            options={[
              { value: 'all', label: `Todos${q.data ? ` (${all.length})` : ''}` },
              { value: 'buy', label: `Compra${q.data ? ` (${count('buy')})` : ''}` },
              { value: 'add', label: `Reforço${q.data ? ` (${count('add')})` : ''}` },
              { value: 'sell', label: `Venda${q.data ? ` (${count('sell')})` : ''}` },
            ]} />
          <div style={{ minWidth: '9rem' }}>
            <Field label="Período">
              {(p) => (
                <select {...p} className="select" value={sessions} onChange={(e) => setParam('sessoes', e.target.value, '5')} style={{ minHeight: '2.75rem' }}>
                  {PERIODS.map((n) => <option key={n} value={n}>{n === '1' ? 'Última sessão' : `Últimas ${n} sessões`}</option>)}
                </select>
              )}
            </Field>
          </div>
        </div>
      </div>

      <div className="stack">
        <Notice>
          Estratégia {strategy.name}: {strategy.rules}
          Os sinais resultam de uma simulação sobre dados diários; não são recomendações de investimento. Comprar e Vender abrem uma ordem para a conta de simulação da SAXO; «Avisar-me» cria um alerta que lhe envia um email quando a estratégia der um sinal neste instrumento.
        </Notice>
        {alertError && <Notice tone="error">{alertError}</Notice>}

        <section className="card" aria-labelledby="sig-title">
          <div className="card-head">
            <h2 id="sig-title" className="card-title">Sinais{q.data?.latestSession ? ` até ${f.date(q.data.latestSession)}` : ''}</h2>
            <div className="row">
              {q.data && <span className="small muted">{items.length} {items.length === 1 ? 'sinal' : 'sinais'}</span>}
              {saxo.data?.configured && !saxo.data.expired && items.length > 0 && (
                <Button size="small" onClick={() => setSaxoBatch(true)} title="Pré-validar e enviar à conta de simulação da SAXO uma ordem por sinal da lista">Enviar sinais à SAXO</Button>
              )}
            </div>
          </div>
          {q.isPending ? <Loading rows={6} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : items.length === 0 ? (
            q.data.instruments === 0 ? (
              <EmptyState title="A sua lista está vazia" action={<Link className="button" to="/acompanhar">Acompanhar instrumentos</Link>}>
                Os sinais são calculados para os instrumentos da sua lista.
              </EmptyState>
            ) : <EmptyState title="Sem sinais no período">Experimente alargar o período ou mudar o tipo de sinal.</EmptyState>
          ) : (
            <div className="table-wrap" tabIndex={0} aria-label="Tabela de sinais" style={{ opacity: q.isFetching ? 0.6 : 1 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Sessão</th>
                    <th scope="col">Sinal</th>
                    <th scope="col">Instrumento</th>
                    <th scope="col" className="r">Preço do sinal</th>
                    <th scope="col" className="r">Desde o sinal</th>
                    <th scope="col" className="r">SMA10/SMA200</th>
                    <th scope="col"><span className="visually-hidden">Acções</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const s = SIDES[i.side];
                    const instrument = { id: i.instrumentId, symbol: i.symbol, name: i.name, currency: 'EUR' };
                    const qty = held.get(i.instrumentId) ?? 0;
                    return (
                      <tr key={`${i.instrumentId}-${i.side}-${i.date}`}>
                        <td className="small" style={{ whiteSpace: 'nowrap' }}>
                          {f.date(i.date)}
                          <div className="muted">{i.sessionsAgo === 0 ? 'última sessão' : `há ${i.sessionsAgo} ${i.sessionsAgo === 1 ? 'sessão' : 'sessões'}`}</div>
                        </td>
                        <td>
                          <span className={`badge ${s.cls}`}><strong>{s.letter}</strong> {s.label}</span>
                          {i.reason && strategy.reasonLabels?.[i.reason] && i.reason !== 'signal' && <div className="small muted">{strategy.reasonLabels[i.reason]}</div>}
                        </td>
                        <td>
                          <Link to={`/instrumentos/${i.instrumentId}?estrategia=${strategyId}`} className="row-link">{i.symbol}</Link>
                          <div className="small muted cx-name">{i.name}</div>
                        </td>
                        <td className="r">{f.price(i.price)}</td>
                        <td className="r">
                          <PriceChange value={i.changeSincePct} showLabel={false} />
                          <div className="small muted">{f.price(i.lastClose)} a {f.shortDate(i.lastDate)}</div>
                        </td>
                        <td className="r">{i.momentumPct == null ? '—' : <PriceChange value={i.momentumPct} showLabel={false} />}</td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }}>
                          <Button size="small" onClick={() => notifyMe(i)} busy={alertBusy === i.instrumentId} disabled={alerted.has(i.instrumentId)}
                            title={alerted.has(i.instrumentId) ? `Já tem um alerta de sinais da ${strategy.name} neste instrumento (ver Alertas)` : `Receber um email quando a ${strategy.name} der um sinal neste instrumento`}>
                            {alerted.has(i.instrumentId) ? 'Com alerta' : 'Avisar-me'}<span className="visually-hidden"> {i.symbol}</span>
                          </Button>{' '}
                          {saxo.data?.configured && (
                            i.side === 'sell' ? (
                              <Button size="small" disabled={qty === 0} onClick={() => setSaxoTrade({ instrument: { ...instrument, latest: { close: i.lastClose } }, side: 'sell', quantity: qty })}
                                title={qty === 0 ? 'A conta SAXO não tem este instrumento' : `Vender as ${f.quantity(qty)} unidades que a conta SAXO tem`}>
                                Vender na SAXO<span className="visually-hidden"> {i.symbol}</span>
                              </Button>
                            ) : (
                              <Button size="small" onClick={() => setSaxoTrade({ instrument: { ...instrument, latest: { close: i.lastClose } }, side: 'buy', quantity: Math.max(1, Math.floor(budget / Number(i.lastClose))) })}
                                title={`Comprar na conta de simulação da SAXO: ≈ ${f.money(budget, 'EUR', 0)} (orçamento da estratégia) ao último preço`}>
                                Comprar na SAXO<span className="visually-hidden"> {i.symbol}</span>
                              </Button>
                            )
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <SaxoBatchDialog open={saxoBatch} onClose={() => setSaxoBatch(false)} signals={items} budget={budget} strategyName={strategy.name} />
      <SaxoOrderDialog open={!!saxoTrade} onClose={() => setSaxoTrade(null)} instrument={saxoTrade?.instrument} initialSide={saxoTrade?.side} initialQuantity={saxoTrade?.quantity} />
    </>
  );
}
