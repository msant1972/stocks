import { createHash } from 'node:crypto';
import { InstrumentNotFoundError, InvalidInstrumentError, UpstreamError } from './errors.js';
import { isValidIsin, isValidMic } from './instrument.js';
import { parseOrderBook } from './parse.js';

export const LANGS = ['en', 'fr', 'nl', 'pt-pt', 'nb', 'de', 'it', 'el'];
export const MIN_WATCH_SEC = 30;
export const CACHE_TTL_MS = 30_000;

/** Opções por omissão, configuráveis por variáveis de ambiente (§9). */
export function defaultOptions(env = process.env) {
  return {
    baseUrl: env.EURONEXT_BASE_URL || 'https://live.euronext.com',
    lang: env.EURONEXT_LANG || 'en',
    timeoutMs: Number(env.EURONEXT_TIMEOUT_MS || 10_000),
    userAgent: env.EURONEXT_USER_AGENT || 'euronext-orderbook/0.1',
    retries: 2,
  };
}

// Cache em memória partilhada por todo o processo: no máximo 1 pedido / 30 s por instrumento (§9).
// Guarda a promessa, para que pedidos simultâneos ao mesmo instrumento partilhem um só pedido HTTP.
const cache = new Map();
export const clearCache = () => cache.clear();

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Livro de ofertas de um instrumento (§6.1).
 * opts: FetchOptions + { logger, warn, fetchImpl, sleep, now, cache: false }.
 */
export async function fetchOrderBook(isin, mic, opts = {}) {
  const o = { ...defaultOptions(), ...opts };
  const url = `${o.baseUrl.replace(/\/$/, '')}/${o.lang}/ajax/getOrderBookCanvas/${isin}-${mic}`;
  const ctx = { isin, mic, url };
  if (!isValidIsin(isin)) throw new InvalidInstrumentError(`ISIN inválido: ${isin}`, ctx);
  if (!isValidMic(mic)) throw new InvalidInstrumentError(`MIC inválido: ${mic}`, ctx);
  if (!LANGS.includes(o.lang)) throw new InvalidInstrumentError(`língua não suportada: ${o.lang}`, ctx);

  const now = o.now ?? Date.now;
  const key = url;
  const hit = o.cache === false ? null : cache.get(key);
  if (hit && now() - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = request(url, ctx, o);
  if (o.cache !== false) {
    cache.set(key, { at: now(), promise });
    promise.catch(() => cache.delete(key)); // falhas não ficam em cache
  }
  return promise;
}

async function request(url, ctx, o) {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? sleepReal;
  const log = o.logger ?? null;
  const warn = o.warn ?? ((code, message) => log?.warn?.({ code, ...ctx }, message));
  let lastError;
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    if (attempt > 0) {
      // Backoff exponencial 1 s, 2 s, 4 s … com ±25% de variação (§8).
      const base = 1000 * 2 ** (attempt - 1);
      await sleep(Math.round(base * (0.75 + Math.random() * 0.5)));
    }
    const started = Date.now();
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { 'User-Agent': o.userAgent, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        signal: AbortSignal.timeout(o.timeoutMs),
      });
    } catch (err) {
      lastError = new UpstreamError(`falha de rede: ${err.name === 'TimeoutError' ? 'tempo esgotado' : err.message}`, { ...ctx, cause: err });
      log?.debug?.({ url, error: err.message, ms: Date.now() - started }, 'orderbook: falha de rede');
      continue;
    }
    log?.debug?.({ url, status: res.status, ms: Date.now() - started }, 'orderbook: resposta');
    if (res.status === 429 || res.status >= 500) {
      lastError = new UpstreamError(`HTTP ${res.status}`, ctx);
      continue;
    }
    if (res.status === 404) throw new InstrumentNotFoundError('instrumento não encontrado (HTTP 404)', ctx);
    if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, ctx);
    const body = await res.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      // HTML em vez de JSON: a Euronext devolve uma página quando o instrumento não existe.
      throw new InstrumentNotFoundError('resposta não é JSON (provável instrumento inexistente)', { ...ctx, excerpt: body.slice(0, 500) });
    }
    return parseOrderBook(json, { ...ctx, fetchedAt: new Date(), warn });
  }
  throw lastError;
}

/** Hash do conteúdo relevante, para só notificar quando o livro muda (§6.1). */
export function bookHash(book) {
  return createHash('sha256').update(JSON.stringify([book.bids, book.asks, book.updatedAt])).digest('hex');
}

/**
 * Consulta periódica (§6.1): intervalo mínimo de 30 s; onUpdate só quando o conteúdo muda;
 * erros transitórios vão para onError e não param o ciclo. Devolve { stop() }.
 */
export function watchOrderBook(isin, mic, intervalSec, onUpdate, opts = {}) {
  const { onError = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, ...fetchOpts } = opts;
  const everyMs = Math.max(MIN_WATCH_SEC, Number(intervalSec) || 0) * 1000;
  let lastHash = null;
  let timer = null;
  let stopped = false;
  const tick = async () => {
    try {
      const book = await fetchOrderBook(isin, mic, fetchOpts);
      const h = bookHash(book);
      if (h !== lastHash) {
        lastHash = h;
        onUpdate(book);
      }
    } catch (err) {
      onError(err);
    }
    if (!stopped) timer = setTimer(tick, everyMs);
  };
  tick();
  return {
    intervalMs: everyMs,
    stop() {
      stopped = true;
      if (timer) clearTimer(timer);
    },
  };
}
