/**
 * Módulo euronext-orderbook (docs/arquitectura/orderbook-spec.md): livro de ofertas de um instrumento
 * Euronext, obtido do endpoint público de live.euronext.com, com 15 minutos de atraso.
 */
export { fetchOrderBook, watchOrderBook, clearCache, defaultOptions, bookHash, MIN_WATCH_SEC, CACHE_TTL_MS } from './client.js';
export { parseOrderBook, DELAY_MINUTES } from './parse.js';
export { computeStats } from './stats.js';
export { renderText, SOURCE_NOTE } from './render.js';
export { isValidIsin, isValidMic, parseIsinMic, marketTimeZone, suggestMic, zonedToUtc } from './instrument.js';
export * from './errors.js';

/** Livro e estatísticas prontos para JSON: preços e decimais como string, datas em ISO 8601. */
export function toJson(book, stats) {
  const { tableTotals, ...rest } = book;
  return {
    book: { ...rest, updatedAt: book.updatedAt?.toISOString() ?? null, fetchedAt: book.fetchedAt.toISOString() },
    stats,
  };
}
