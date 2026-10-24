import * as f from '../../lib/format.js';
import { PnL } from './finance.jsx';

function Reinforcements({ lots }) {
  if (lots.length < 2) return null;
  return (
    <div className="small muted" style={{ whiteSpace: 'normal' }}>
      + {lots.length - 1} {lots.length === 2 ? 'reforço' : 'reforços'}: {lots.slice(1).map((l) => `${f.shortDate(l.date)} a ${f.price(l.price)}`).join(', ')}
    </div>
  );
}

/** Resultado da simulação de uma estratégia do registo no histórico (não altera a carteira). */
export default function StrategyPanel({ strategy, result, currency = 'EUR', symbol }) {
  const { trades, open, summary, firstDate, skipped, sellsHeld, trendBlocked, stops, exitReasons, gapCancels, blocked } = result;
  const bh = summary.buyHold;
  const labels = strategy.reasonLabels ?? {};
  const exits = exitReasons
    ? Object.entries(exitReasons).filter(([, n]) => n > 0).map(([k, n]) => `${n} por ${labels[k] ?? k}`).join(', ')
    : '';
  // Critérios de entrada que falharam nas revisões (B-Opus), para explicar a ausência de compras.
  const BLOCKED_LABEL = {
    liquidity: 'liquidez', trend: 'tendência', momentum: 'momento', trendStrength: 'tendência pouco limpa (Efficiency Ratio)',
    cooldown: 'arrefecimento após stop', volume: 'volume', overextension: 'sobreextensão',
  };
  const blockedText = blocked
    ? Object.entries(blocked).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${BLOCKED_LABEL[k] ?? k} (${n})`).join(', ')
    : '';
  const notes = [
    sellsHeld > 0 && `${sellsHeld} ${sellsHeld === 1 ? 'venda não executada' : 'vendas não executadas'} pela condição do SMA8/SMA125`,
    skipped > 0 && `${skipped} ${skipped === 1 ? 'sinal ignorado' : 'sinais ignorados'} na zona neutra`,
    trendBlocked > 0 && `${trendBlocked} ${trendBlocked === 1 ? 'compra não feita' : 'compras não feitas'} com o preço abaixo da SMA200`,
    stops > 0 && `${stops} ${stops === 1 ? 'venda' : 'vendas'} pela protecção dos reforços`,
    exits && `vendas: ${exits}`,
    gapCancels > 0 && `${gapCancels} ${gapCancels === 1 ? 'compra cancelada' : 'compras canceladas'} por abertura acima de 1 ATR`,
  ].filter(Boolean);
  return (
    <section className="stack" style={{ gap: '1rem' }} aria-labelledby="strategy-title">
      <div>
        <h3 id="strategy-title" style={{ fontSize: '1.0625rem', fontWeight: 600 }}>{strategy.name} — simulação no histórico</h3>
        <p className="small muted" style={{ marginTop: 4 }}>
          {strategy.rules}{notes.length > 0 && ` No período: ${notes.join('; ')}.`} Período: {firstDate ? `desde ${f.date(firstDate)}` : 'sem dados suficientes'}.
          Não altera a carteira virtual.
        </p>
      </div>

      <div className="stats" style={{ marginTop: 0 }}>
        <div>
          <p className="stat-label">Resultado da estratégia</p>
          <p className="stat-value"><PnL value={summary.total} currency={currency} /> <span className="small muted">{f.pct(summary.totalPct.toFixed(2))}</span></p>
          <p className="small muted">sobre o capital máximo investido ({f.money(summary.peakCost, currency, 0)})</p>
        </div>
        <div>
          <p className="stat-label">Operações fechadas</p>
          <p className="stat-value">{summary.closed}</p>
          <p className="small muted">{summary.wins} com ganho · {summary.closed - summary.wins} com perda · {summary.reinforcements} {summary.reinforcements === 1 ? 'reforço' : 'reforços'}</p>
        </div>
        <div>
          <p className="stat-label">Posição aberta</p>
          <p className="stat-value">{open ? <PnL value={open.pnl} currency={currency} /> : '—'}</p>
          <p className="small muted">
            {open ? `${f.quantity(open.quantity)} un. desde ${f.date(open.buyDate)}` : 'Sem posição no fim do período'}
            {open?.stop != null && <> · stop {f.price(open.stop, currency)}</>}
          </p>
        </div>
        <div>
          <p className="stat-label">Comprar e manter</p>
          <p className="stat-value">{bh ? <><PnL value={bh.pnl} currency={currency} /> <span className="small muted">{f.pct(bh.pnlPct.toFixed(2))}</span></> : '—'}</p>
          <p className="small muted">{bh ? `${f.money(strategy.budget ?? bh.cost, currency, 0)} em ${symbol} desde ${f.date(bh.startDate)}` : ''}</p>
        </div>
      </div>

      {trades.length === 0 && !open ? (
        <p className="small muted">
          {blockedText
            ? `Sem compras no período. Critérios que impediram a compra nas revisões semanais (número de revisões): ${blockedText}.`
            : 'O padrão de compra não ocorreu no período disponível.'}
        </p>
      ) : (
        <div className="table-wrap" tabIndex={0} aria-label="Operações da estratégia">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Compra</th>
                <th scope="col" className="r">Preço médio</th>
                <th scope="col" className="r">Unidades</th>
                <th scope="col" className="r">Investido</th>
                <th scope="col">Venda</th>
                <th scope="col" className="r">Preço</th>
                <th scope="col" className="r">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.buyDate}>
                  <td style={{ whiteSpace: 'nowrap' }}>{f.date(t.buyDate)}<Reinforcements lots={t.lots} /></td>
                  <td className="r">{f.price(t.avgPrice, currency)}</td>
                  <td className="r">{f.quantity(t.quantity)}</td>
                  <td className="r">{f.money(t.cost, currency)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {f.date(t.sellDate)}
                    {t.reason && labels[t.reason] && t.reason !== 'signal' && <div className="small muted">{labels[t.reason]}</div>}
                  </td>
                  <td className="r">{f.price(t.sellPrice, currency)}</td>
                  <td className="r"><PnL value={t.pnl} currency={currency} /><div className="small muted">{f.pct(t.pnlPct.toFixed(2))}</div></td>
                </tr>
              ))}
              {open && (
                <tr>
                  <td style={{ whiteSpace: 'nowrap' }}>{f.date(open.buyDate)}<Reinforcements lots={open.lots} /></td>
                  <td className="r">{f.price(open.avgPrice, currency)}</td>
                  <td className="r">{f.quantity(open.quantity)}</td>
                  <td className="r">{f.money(open.cost, currency)}</td>
                  <td className="muted small">Em aberto · {f.price(open.lastPrice, currency)} a {f.date(open.lastDate)}</td>
                  <td className="r muted">—</td>
                  <td className="r"><PnL value={open.pnl} currency={currency} /><div className="small muted">{f.pct(open.pnlPct.toFixed(2))} não realizado</div></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Resultados simulados sobre dados passados, com preços reais (não ajustados); não garantem resultados futuros e não são uma recomendação de investimento.</p>
    </section>
  );
}
