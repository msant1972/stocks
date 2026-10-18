import { useState } from 'react';
import { Link } from 'react-router';
import * as f from '../../lib/format.js';
import { usePortfolio, useWatchlist } from '../../lib/queries.js';
import { PnL, QuoteDate, SimulatedBadge } from '../../components/finance/finance.jsx';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { Button, Dialog, Field } from '../../components/ui/controls.jsx';
import TradeDialog from './TradeDialog.jsx';

/** Escolha do instrumento antes de abrir a simulação de compra. */
function PickInstrument({ open, onClose, onPick }) {
  const wl = useWatchlist();
  const options = wl.data?.items.filter((i) => i.status === 'active' && i.currency === 'EUR' && i.latest) ?? [];
  const [id, setId] = useState('');
  return (
    <Dialog open={open} onClose={onClose} title="Simular compra">
      {wl.isPending ? <Loading /> : options.length === 0 ? (
        <EmptyState title="Nenhum instrumento disponível" action={<Link className="button" to="/acompanhar" onClick={onClose}>Acompanhar instrumentos</Link>}>
          Só é possível simular instrumentos activos, em EUR, que estejam na sua lista.
        </EmptyState>
      ) : (
        <>
          <Field label="Instrumento">
            {(p) => (
              <select {...p} className="select" value={id} onChange={(e) => setId(e.target.value)}>
                <option value="">Escolha um instrumento</option>
                {options.map((i) => <option key={i.id} value={i.id}>{i.symbol}{i.name ? ` — ${i.name}` : ''}</option>)}
              </select>
            )}
          </Field>
          <div className="modal-actions">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!id} onClick={() => onPick(options.find((i) => String(i.id) === id))}>Continuar</Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

export default function PortfolioPage() {
  const { data: p, isPending, error, refetch } = usePortfolio();
  const [picking, setPicking] = useState(false);
  const [trade, setTrade] = useState(null); // { instrument, side }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Carteira virtual</h1>
          <div className="row" style={{ marginTop: 8 }}><SimulatedBadge /></div>
        </div>
        <div className="row">
          <Link className="button" to="/operacoes">Ver operações</Link>
          <Button variant="primary" onClick={() => setPicking(true)}>Simular compra</Button>
        </div>
      </div>

      {isPending ? <Loading rows={6} /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <div className="stack">
          <section className="card" aria-labelledby="totals-title">
            <h2 id="totals-title" className="card-title" style={{ marginBottom: '0.5rem' }}>Valor total</h2>
            <p className="hero-value">{f.money(p.totalValue, p.currency)}</p>
            <p className="small muted" style={{ marginTop: 4 }}>
              Saldo disponível mais valor das posições ao último fecho{p.valuationDate ? ` (${f.date(p.valuationDate)})` : ''}.
            </p>
            <div className="stats">
              <div><p className="stat-label">Saldo disponível</p><p className="stat-value">{f.money(p.cashBalance, p.currency)}</p></div>
              <div><p className="stat-label">Valor das posições</p><p className="stat-value">{f.money(p.marketValue, p.currency)}</p></div>
              <div><p className="stat-label">Resultado não realizado</p><p className="stat-value"><PnL value={p.unrealizedPnl} currency={p.currency} /></p></div>
              <div><p className="stat-label">Resultado realizado (vendas)</p><p className="stat-value"><PnL value={p.realizedPnl} currency={p.currency} /></p></div>
              <div>
                <p className="stat-label">Resultado acumulado</p>
                <p className="stat-value"><PnL value={p.totalPnl} currency={p.currency} /> <span className="small muted">{f.pct(p.totalPnlPct)}</span></p>
                <p className="small muted">Valor total face ao capital inicial de {f.money(p.initialCapital, p.currency)}</p>
              </div>
            </div>
          </section>

          <section className="card" aria-labelledby="pos-title">
            <div className="card-head">
              <h2 id="pos-title" className="card-title">Posições</h2>
              <span className="small muted">Custo médio ponderado</span>
            </div>
            {p.positions.length === 0 ? (
              <EmptyState title="Ainda não tem posições" action={<Button onClick={() => setPicking(true)}>Simular a primeira compra</Button>}>
                As compras simuladas usam o último fecho diário disponível.
              </EmptyState>
            ) : (
              <div className="table-wrap" tabIndex={0} aria-label="Tabela de posições">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Instrumento</th>
                      <th scope="col" className="r">Quantidade</th>
                      <th scope="col" className="r">Custo médio</th>
                      <th scope="col" className="r">Preço de referência</th>
                      <th scope="col" className="r">Valor</th>
                      <th scope="col" className="r">Resultado</th>
                      <th scope="col"><span className="visually-hidden">Acções</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.positions.map((pos) => {
                      const instrument = { id: pos.instrumentId, symbol: pos.symbol, name: pos.name, currency: p.currency };
                      return (
                        <tr key={pos.instrumentId}>
                          <td>
                            <Link to={`/instrumentos/${pos.instrumentId}`} className="row-link">{pos.symbol}</Link>
                            <div className="small muted">{[pos.name, pos.exchange].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className="r">{f.quantity(pos.quantity)}</td>
                          <td className="r">{f.price(pos.averageCost, p.currency)}</td>
                          <td className="r">
                            {f.price(pos.price, p.currency)}
                            <div><QuoteDate date={pos.quoteDate} prefix="" /></div>
                          </td>
                          <td className="r">{f.money(pos.marketValue, p.currency)}</td>
                          <td className="r">
                            <PnL value={pos.unrealizedPnl} currency={p.currency} />
                            <div className="small muted">{f.pct(pos.unrealizedPct)}</div>
                          </td>
                          <td className="r" style={{ whiteSpace: 'nowrap' }}>
                            <Button size="small" variant="ghost" onClick={() => setTrade({ instrument, side: 'buy' })}>Comprar<span className="visually-hidden"> {pos.symbol}</span></Button>
                            <Button size="small" variant="ghost" onClick={() => setTrade({ instrument, side: 'sell' })}>Vender<span className="visually-hidden"> {pos.symbol}</span></Button>
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
      )}

      <PickInstrument open={picking} onClose={() => setPicking(false)}
        onPick={(i) => { setPicking(false); setTrade({ instrument: i, side: 'buy' }); }} />
      <TradeDialog open={!!trade} onClose={() => setTrade(null)} instrument={trade?.instrument} initialSide={trade?.side} />
    </>
  );
}
