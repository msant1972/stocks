import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/**
 * Gráfico de profundidade cumulativa em degrau (especificação §7.3): eixo X preço, eixo Y quantidade
 * acumulada desde o melhor preço; compras à esquerda do mid, vendas à direita.
 */
export default function DepthChart({ book, stats, places }) {
  const fmt = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: places, maximumFractionDigits: places });
  const qty = new Intl.NumberFormat('pt-PT', { useGrouping: 'always' });

  // Compras: do melhor preço (mais alto) para baixo; vendas: do melhor (mais baixo) para cima.
  let acc = 0;
  const bids = book.bids.map((l) => ({ price: Number(l.price), bid: (acc += l.quantity) })).reverse();
  acc = 0;
  const asks = book.asks.map((l) => ({ price: Number(l.price), ask: (acc += l.quantity) }));
  const data = [...bids, ...asks];

  const summary = `Compras acumuladas: ${qty.format(stats.bidVolume)} acções até ${book.bids.length ? fmt.format(Number(book.bids.at(-1).price)) : '—'}; `
    + `vendas acumuladas: ${qty.format(stats.askVolume)} acções até ${book.asks.length ? fmt.format(Number(book.asks.at(-1).price)) : '—'}.`;

  return (
    <>
      <div className="chart-box" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="price" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => fmt.format(v)}
              tickLine={false} axisLine={false} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
            <YAxis width={64} tickLine={false} axisLine={false} tickFormatter={(v) => qty.format(v)}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
            <Tooltip
              formatter={(value, name) => [qty.format(value), name === 'bid' ? 'Compras acumuladas' : 'Vendas acumuladas']}
              labelFormatter={(v) => `Preço ${fmt.format(v)} €`}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}
            />
            {stats.mid != null && <ReferenceLine x={Number(stats.mid)} stroke="var(--control-border)" strokeDasharray="4 4" label={{ value: 'mid', fill: 'var(--text-secondary)', fontSize: 11, position: 'top' }} />}
            <Area type="stepBefore" dataKey="bid" stroke="var(--positive)" fill="var(--positive)" fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} connectNulls={false} />
            <Area type="stepAfter" dataKey="ask" stroke="var(--negative)" fill="var(--negative)" fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} connectNulls={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        <span className="positive">■</span> Compras (à esquerda do mid) · <span className="negative">■</span> Vendas (à direita). {summary}
      </p>
    </>
  );
}
