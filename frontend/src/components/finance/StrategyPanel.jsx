import * as f from '../../lib/format.js';
import { NEUTRAL_BAND, SELL_MAX_WAVE125, STRATEGY_BUDGET } from '../../lib/strategy.js';
import { PnL } from './finance.jsx';

/** Resultado da simulação da estratégia de momento no histórico (não altera a carteira). */
export default function StrategyPanel({ result, currency = 'EUR', symbol }) {
  const { trades, open, summary, firstDate, skipped, sellsHeld } = result;
  const bh = summary.buyHold;
  return (
    <section className="stack" style={{ gap: '1rem' }} aria-labelledby="strategy-title">
      <div>
        <h3 id="strategy-title" style={{ fontSize: '1.0625rem', fontWeight: 600 }}>Estratégia de momento — simulação no histórico</h3>
        <p className="small muted" style={{ marginTop: 4 }}>
          Compra {f.money(STRATEGY_BUDGET, currency, 0)} quando o SMA10/SMA200 tem uma sessão «a descer» seguida de duas «a subir»;
          vende tudo após uma «a subir» seguida de duas «a descer», mas só com o SMA8/SMA125 abaixo de {SELL_MAX_WAVE125}%
          {sellsHeld > 0 && `(${sellsHeld} ${sellsHeld === 1 ? 'venda não executada' : 'vendas não executadas'} por esta condição)`}. Os sinais são ignorados quando o SMA10/SMA200 está entre
          −{NEUTRAL_BAND}% e +{NEUTRAL_BAND}%{skipped > 0 && ` (${skipped} ${skipped === 1 ? 'sinal ignorado' : 'sinais ignorados'} no período)`}. Executa ao fecho da sessão do sinal, uma posição de cada vez,
          sem comissões. Período: {firstDate ? `desde ${f.date(firstDate)}` : 'sem dados suficientes'}. Não altera a carteira virtual.
        </p>
      </div>

      <div className="stats" style={{ marginTop: 0 }}>
        <div>
          <p className="stat-label">Resultado da estratégia</p>
          <p className="stat-value"><PnL value={summary.total} currency={currency} /> <span className="small muted">{f.pct(summary.totalPct.toFixed(2))}</span></p>
          <p className="small muted">sobre {f.money(STRATEGY_BUDGET, currency, 0)} por operação</p>
        </div>
        <div>
          <p className="stat-label">Operações fechadas</p>
          <p className="stat-value">{summary.closed}</p>
          <p className="small muted">{summary.wins} com ganho · {summary.closed - summary.wins} com perda</p>
        </div>
        <div>
          <p className="stat-label">Posição aberta</p>
          <p className="stat-value">{open ? <PnL value={open.pnl} currency={currency} /> : '—'}</p>
          <p className="small muted">{open ? `${f.quantity(open.quantity)} un. desde ${f.date(open.buyDate)}` : 'Sem posição no fim do período'}</p>
        </div>
        <div>
          <p className="stat-label">Comprar e manter</p>
          <p className="stat-value">{bh ? <><PnL value={bh.pnl} currency={currency} /> <span className="small muted">{f.pct(bh.pnlPct.toFixed(2))}</span></> : '—'}</p>
          <p className="small muted">{bh ? `${f.money(STRATEGY_BUDGET, currency, 0)} em ${symbol} desde ${f.date(bh.startDate)}` : ''}</p>
        </div>
      </div>

      {trades.length === 0 && !open ? (
        <p className="small muted">O padrão de compra não ocorreu no período disponível.</p>
      ) : (
        <div className="table-wrap" tabIndex={0} aria-label="Operações da estratégia">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Compra</th>
                <th scope="col" className="r">Preço</th>
                <th scope="col" className="r">Unidades</th>
                <th scope="col">Venda</th>
                <th scope="col" className="r">Preço</th>
                <th scope="col" className="r">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.buyDate}>
                  <td style={{ whiteSpace: 'nowrap' }}>{f.date(t.buyDate)}</td>
                  <td className="r">{f.price(t.buyPrice, currency)}</td>
                  <td className="r">{f.quantity(t.quantity)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{f.date(t.sellDate)}</td>
                  <td className="r">{f.price(t.sellPrice, currency)}</td>
                  <td className="r"><PnL value={t.pnl} currency={currency} /><div className="small muted">{f.pct(t.pnlPct.toFixed(2))}</div></td>
                </tr>
              ))}
              {open && (
                <tr>
                  <td style={{ whiteSpace: 'nowrap' }}>{f.date(open.buyDate)}</td>
                  <td className="r">{f.price(open.buyPrice, currency)}</td>
                  <td className="r">{f.quantity(open.quantity)}</td>
                  <td className="muted small">Em aberto · {f.price(open.lastPrice, currency)} a {f.date(open.lastDate)}</td>
                  <td className="r muted">—</td>
                  <td className="r"><PnL value={open.pnl} currency={currency} /><div className="small muted">{f.pct(open.pnlPct.toFixed(2))} não realizado</div></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Resultados simulados sobre dados passados, com fechos reais (não ajustados); não garantem resultados futuros e não são uma recomendação de investimento.</p>
    </section>
  );
}
