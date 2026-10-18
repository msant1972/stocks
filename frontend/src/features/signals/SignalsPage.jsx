import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { usePortfolio } from '../../lib/queries.js';
import { NEUTRAL_BAND, REINFORCE_GAIN, SELL_MAX_WAVE125, STRATEGY_BUDGET } from '../../lib/strategy.js';
import { PriceChange } from '../../components/finance/finance.jsx';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Button, Field, Notice, Segmented } from '../../components/ui/controls.jsx';
import TradeDialog from '../portfolio/TradeDialog.jsx';

const SIDES = {
  buy: { label: 'Compra', letter: 'C', cls: 'badge-positive' },
  add: { label: 'Reforço', letter: 'R', cls: 'badge-accent' },
  sell: { label: 'Venda', letter: 'V', cls: 'badge-negative' },
};
const PERIODS = ['1', '3', '5', '10'];

/** Sinais da estratégia de momento aplicada virtualmente a todos os instrumentos. */
export default function SignalsPage() {
  const [params, setParams] = useSearchParams();
  const side = ['buy', 'add', 'sell'].includes(params.get('tipo')) ? params.get('tipo') : 'all';
  const sessions = PERIODS.includes(params.get('sessoes')) ? params.get('sessoes') : '5';
  const [trade, setTrade] = useState(null); // { instrument, side }
  const portfolio = usePortfolio();
  const q = useQuery({
    queryKey: ['signals', sessions],
    queryFn: () => api.get(`/signals?sessions=${sessions}`),
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  });

  const setParam = (key, value, fallback) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  const held = new Map((portfolio.data?.positions ?? []).map((p) => [p.instrumentId, p.quantity]));
  const all = q.data?.items ?? [];
  const items = side === 'all' ? all : all.filter((i) => i.side === side);
  const count = (s) => all.filter((i) => i.side === s).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Sinais</h1>
          <p className="page-sub">Compras, reforços e vendas da estratégia de momento aplicada virtualmente a todos os instrumentos.</p>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
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
          Regras: compra {f.money(STRATEGY_BUDGET, 'EUR', 0)} quando o SMA10/SMA200 tem uma sessão «a descer» seguida de duas «a subir»;
          reforça quando o fecho sobe mais de {REINFORCE_GAIN}% face à última compra; vende quando tem uma sessão «a subir» seguida de duas
          «a descer» e o SMA8/SMA125 está abaixo de {SELL_MAX_WAVE125}%. Sinais ignorados com o SMA10/SMA200 entre −{NEUTRAL_BAND}% e +{NEUTRAL_BAND}%.
          Os sinais resultam de uma simulação sobre dados diários; não são recomendações de investimento. Os botões abrem uma operação na sua carteira virtual.
        </Notice>

        <section className="card" aria-labelledby="sig-title">
          <div className="card-head">
            <h2 id="sig-title" className="card-title">Sinais{q.data?.latestSession ? ` até ${f.date(q.data.latestSession)}` : ''}</h2>
            {q.data && <span className="small muted">{items.length} {items.length === 1 ? 'sinal' : 'sinais'}</span>}
          </div>
          {q.isPending ? <Loading rows={6} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : items.length === 0 ? (
            <EmptyState title="Sem sinais no período">Experimente alargar o período ou mudar o tipo de sinal.</EmptyState>
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
                        <td><span className={`badge ${s.cls}`}><strong>{s.letter}</strong> {s.label}</span></td>
                        <td>
                          <Link to={`/instrumentos/${i.instrumentId}`} className="row-link">{i.symbol}</Link>
                          <div className="small muted cx-name">{i.name}</div>
                        </td>
                        <td className="r">{f.price(i.price)}</td>
                        <td className="r">
                          <PriceChange value={i.changeSincePct} showLabel={false} />
                          <div className="small muted">{f.price(i.lastClose)} a {f.shortDate(i.lastDate)}</div>
                        </td>
                        <td className="r">{i.momentumPct == null ? '—' : <PriceChange value={i.momentumPct} showLabel={false} />}</td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }}>
                          <Button size="small" onClick={() => setTrade({ instrument, side: 'buy' })}>
                            Comprar<span className="visually-hidden"> {i.symbol}</span>
                          </Button>{' '}
                          <Button size="small" onClick={() => setTrade({ instrument, side: 'sell' })} disabled={qty === 0}
                            title={qty === 0 ? 'Não tem este instrumento na carteira' : `Tem ${f.quantity(qty)} unidades`}>
                            Vender<span className="visually-hidden"> {i.symbol}</span>
                          </Button>
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

      <TradeDialog open={!!trade} onClose={() => setTrade(null)} instrument={trade?.instrument} initialSide={trade?.side} />
    </>
  );
}
