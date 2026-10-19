import { formatDecimal, halve, mulInt, parseDecimal, toNumber } from './decimal.js';

/** Métricas derivadas do livro (especificação §4, OrderBookStats). Decimais como string. */
export function computeStats(book) {
  const bestBidN = book.bids.length ? parseDecimal(book.bids[0].price) : null;
  const bestAskN = book.asks.length ? parseDecimal(book.asks[0].price) : null;
  const both = bestBidN != null && bestAskN != null;
  const spreadN = both ? bestAskN - bestBidN : null;
  const midN = both ? halve(bestBidN + bestAskN) : null;

  const volume = (levels) => levels.reduce((s, l) => s + l.quantity, 0);
  const notional = (levels) => levels.reduce((s, l) => s + mulInt(parseDecimal(l.price), l.quantity), 0n);
  const orders = (levels, tableTotal) => {
    if (levels.length === 0) return tableTotal ?? 0;
    if (levels.every((l) => l.orders != null)) return levels.reduce((s, l) => s + l.orders, 0);
    return tableTotal ?? null;
  };

  const bidVolume = volume(book.bids);
  const askVolume = volume(book.asks);
  const total = bidVolume + askVolume;
  return {
    bestBid: bestBidN == null ? null : formatDecimal(bestBidN),
    bestAsk: bestAskN == null ? null : formatDecimal(bestAskN),
    spread: spreadN == null ? null : formatDecimal(spreadN),
    spreadPct: both && midN > 0n ? toNumber(spreadN) / toNumber(midN) : null,
    mid: midN == null ? null : formatDecimal(midN),
    bidVolume,
    askVolume,
    bidNotional: formatDecimal(notional(book.bids)),
    askNotional: formatDecimal(notional(book.asks)),
    imbalance: total > 0 ? (bidVolume - askVolume) / total : null,
    bidOrders: orders(book.bids, book.tableTotals?.bidOrders),
    askOrders: orders(book.asks, book.tableTotals?.askOrders),
    crossed: both && bestBidN >= bestAskN,
  };
}
