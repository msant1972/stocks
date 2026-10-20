import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCache, computeStats, EncryptedResponseError, fetchOrderBook, InstrumentNotFoundError, InvalidInstrumentError,
  isValidIsin, parseIsinMic, parseOrderBook, renderText, suggestMic, UnexpectedFormatError, UpstreamError,
  watchOrderBook, WARNING, zonedToUtc,
} from '../src/orderbook/index.js';

const FIX = new URL('./fixtures/orderbook/', import.meta.url);
const raw = (name) => fs.readFileSync(new URL(name, FIX), 'utf8');
const fixture = (name) => JSON.parse(raw(name));
const ctx = { isin: 'PTFCP0AM0008', mic: 'XLIS', url: 'https://example.test/en/ajax/getOrderBookCanvas/PTFCP0AM0008-XLIS' };

function parse(name, mic = 'XLIS') {
  const warnings = [];
  const book = parseOrderBook(fixture(name), { ...ctx, mic, warn: (code, message) => warnings.push({ code, message }) });
  return { book, stats: computeStats(book), warnings };
}

/** fetch simulado: devolve as respostas por ordem e regista os pedidos. */
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return new Response(r.body, { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'application/json' } });
  };
  return { impl, calls };
}

describe('ISIN e MIC', () => {
  it('valida o dígito de controlo (Luhn)', () => {
    for (const ok of ['PTFCP0AM0008', 'US0378331005', 'FR0000053951', 'NL0010273215']) expect(isValidIsin(ok)).toBe(true);
    for (const ko of ['PTFCP0AM0009', 'US0378331004', 'pt0000000000', 'PTFCP0AM000', '12FCP0AM0008']) expect(isValidIsin(ko)).toBe(false);
  });

  it('interpreta ISIN-MIC e sugere o MIC pela bolsa', () => {
    expect(parseIsinMic(' ptfcp0am0008-xlis ')).toEqual({ isin: 'PTFCP0AM0008', mic: 'XLIS' });
    expect(parseIsinMic('PTFCP0AM0009-XLIS')).toBeNull();
    expect(parseIsinMic('PTFCP0AM0008-XL')).toBeNull();
    expect([suggestMic('Lisbon'), suggestMic('Paris'), suggestMic('Milan'), suggestMic('XETRA')]).toEqual(['XLIS', 'XPAR', 'MTAA', null]);
  });

  it('converte a hora do mercado para UTC, com horário de Verão', () => {
    expect(zonedToUtc(2026, 10, 19, 16, 40, 'Europe/Lisbon').toISOString()).toBe('2026-10-19T15:40:00.000Z');
    expect(zonedToUtc(2026, 10, 19, 16, 40, 'Europe/Paris').toISOString()).toBe('2026-10-19T14:40:00.000Z');
    expect(zonedToUtc(2026, 12, 1, 9, 0, 'Europe/Paris').toISOString()).toBe('2026-12-01T08:00:00.000Z');
  });
});

describe('parsing e estatísticas', () => {
  it('preços acima de 1000 com separador de milhares (NL0010273215-XAMS, 20/10/2026)', () => {
    const { book, stats, warnings } = parse('nl0010273215-xams.json', 'XAMS');
    expect(warnings).toEqual([]);
    expect([book.bids.length, book.asks.length]).toEqual([10, 10]);
    expect(stats).toMatchObject({ bestBid: '1455', bestAsk: '1460', bidVolume: 450, askVolume: 347, crossed: false });
  });

  it('só aceita grupos de milhares bem formados', () => {
    const json = { chart_data: [{ price: '1,5', qtt: '10' }, { price: '12,34.5', qtt: '-1' }, { price: '2,000.5', qtt: '-1,200' }], table: '' };
    const warnings = [];
    const book = parseOrderBook(json, { ...ctx, warn: (code) => warnings.push(code) });
    expect(warnings.filter((w) => w === WARNING.MALFORMED_LEVEL)).toHaveLength(2);
    expect(book.bids).toEqual([{ side: 'bid', price: '2000.5', quantity: 1200, orders: null }]);
  });

  it('resposta real de 19/10/2026 16:40 (PTFCP0AM0008-XLIS)', () => {
    const { book, stats, warnings } = parse('ptfcp0am0008-xlis.json');
    expect(warnings).toEqual([]);
    expect([book.bids.length, book.asks.length]).toEqual([2, 10]);
    expect(book.bids.map((l) => l.price)).toEqual(['2.56', '2.5']);
    expect(book.asks[0]).toEqual({ side: 'ask', price: '2.8', quantity: 3000, orders: 1 });
    expect(book.asks.find((l) => l.price === '3').orders).toBe(3);
    expect(book.asks.map((l) => Number(l.price))).toEqual([...book.asks.map((l) => Number(l.price))].sort((a, b) => a - b));
    expect(book.updatedAt.toISOString()).toBe('2026-10-19T15:40:00.000Z');
    expect(book.delayMinutes).toBe(15);
    expect(stats).toMatchObject({
      bestBid: '2.56', bestAsk: '2.8', spread: '0.24', mid: '2.68', bidVolume: 3440, askVolume: 36990,
      bidOrders: 3, askOrders: 15, crossed: false, bidNotional: '8746.4',
    });
    expect(stats.spreadPct).toBeCloseTo(0.0896, 4);
    expect(stats.imbalance).toBeCloseTo(-0.83, 2);
  });

  it('livro vazio não é erro', () => {
    const { book, stats } = parse('empty.json');
    expect([book.bids, book.asks]).toEqual([[], []]);
    expect(stats).toMatchObject({ bestBid: null, bestAsk: null, spread: null, mid: null, imbalance: null, spreadPct: null, crossed: false });
    expect(renderText(book, stats, { color: false })).toContain('Sem ofertas disponíveis para PTFCP0AM0008-XLIS.');
  });

  it('livros com um só lado', () => {
    for (const [name, side] of [['one-sided-asks.json', 'asks'], ['one-sided-bids.json', 'bids']]) {
      const { book, stats } = parse(name);
      expect(book[side].length).toBeGreaterThan(0);
      expect([stats.spread, stats.mid]).toEqual([null, null]);
      expect(renderText(book, stats, { color: false })).toContain('Fonte: Euronext, atraso 15 min');
    }
  });

  it('livro cruzado', () => {
    const { book, stats } = parse('crossed.json');
    expect(stats.crossed).toBe(true);
    expect(renderText(book, stats, { color: false })).toContain('LIVRO CRUZADO (provável leilão)');
  });

  it('descarta níveis malformados, ignora qtt 0 e campos desconhecidos', () => {
    const { book, warnings } = parse('malformed-level.json');
    expect(book.bids.map((l) => [l.price, l.quantity, l.orders])).toEqual([['4.9', 70, 2]]);
    expect(book.asks.map((l) => [l.price, l.quantity, l.orders])).toEqual([['5.1', 100, 3]]);
    expect(warnings.filter((w) => w.code === WARNING.MALFORMED_LEVEL)).toHaveLength(3);
  });

  it('totais divergentes e ordens não associáveis geram avisos, não erros', () => {
    const { book, stats, warnings } = parse('table-mismatch.json');
    expect(warnings.map((w) => w.code).sort()).toEqual([WARNING.INCONSISTENCY, WARNING.ORDERS_UNMATCHED].sort());
    expect(book.asks.find((l) => l.price === '7.2').orders).toBeNull();
    expect(stats.askOrders).toBe(2); // usa o total da tabela quando falta o nº de ordens de um nível
  });

  it('formato cifrado e formato inesperado', () => {
    expect(() => parse('encrypted.json')).toThrow(EncryptedResponseError);
    expect(() => parseOrderBook({ foo: 1 }, ctx)).toThrow(UnexpectedFormatError);
    try {
      parseOrderBook({ foo: 'x'.repeat(2000) }, ctx);
    } catch (e) {
      expect(e.excerpt.length).toBeLessThanOrEqual(500);
      expect([e.isin, e.mic, e.url]).toEqual([ctx.isin, ctx.mic, ctx.url]);
    }
  });

  it('parsing independente da cultura, também com saída em pt-PT', () => {
    const { book, stats } = parse('ptfcp0am0008-xlis.json');
    const text = renderText(book, stats, { color: false, locale: 'pt-PT' });
    expect(text).toContain('2,56');
    expect(text).toContain('36 990');
    expect(text).toContain('2 440');
    expect(text).toContain('Spread 0,24 (8,96 %)');
    expect(text).toContain('−0,83 (pressão vendedora)');
    expect(renderText(book, stats, { color: false, layout: 'ladder', levels: 2 })).toContain('spread 0,24');
  });

  it('analisa uma resposta típica em menos de 50 ms', () => {
    const json = fixture('ptfcp0am0008-xlis.json');
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) parseOrderBook(json, ctx);
    expect((performance.now() - t0) / 20).toBeLessThan(50);
  });
});

describe('cliente HTTP', () => {
  beforeEach(() => clearCache());
  const opts = (impl, extra = {}) => ({ baseUrl: 'https://example.test', fetchImpl: impl, sleep: async () => {}, ...extra });

  it('ISIN inválido não faz pedido', async () => {
    const f = fakeFetch([{ body: '{}' }]);
    await expect(fetchOrderBook('PTFCP0AM0009', 'XLIS', opts(f.impl))).rejects.toBeInstanceOf(InvalidInstrumentError);
    expect(f.calls).toHaveLength(0);
  });

  it('envia os cabeçalhos e usa a cache de 30 s (um pedido por instrumento)', async () => {
    const f = fakeFetch([{ body: raw('ptfcp0am0008-xlis.json') }]);
    let now = 1_000_000;
    const o = opts(f.impl, { now: () => now });
    const [a, b] = await Promise.all([fetchOrderBook('PTFCP0AM0008', 'XLIS', o), fetchOrderBook('PTFCP0AM0008', 'XLIS', o)]);
    expect(a).toBe(b);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('https://example.test/en/ajax/getOrderBookCanvas/PTFCP0AM0008-XLIS');
    expect(f.calls[0].init.headers).toMatchObject({ Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' });
    now += 31_000;
    await fetchOrderBook('PTFCP0AM0008', 'XLIS', o);
    expect(f.calls).toHaveLength(2);
  });

  it('retenta em 5xx/429/rede com backoff exponencial e depois falha com UpstreamError', async () => {
    const f = fakeFetch([{ status: 503, body: '' }, { status: 429, body: '' }, new TypeError('ECONNRESET')]);
    const waits = [];
    await expect(fetchOrderBook('PTFCP0AM0008', 'XLIS', opts(f.impl, { retries: 2, sleep: async (ms) => waits.push(ms) })))
      .rejects.toBeInstanceOf(UpstreamError);
    expect(f.calls).toHaveLength(3);
    expect(waits[0]).toBeGreaterThanOrEqual(750);
    expect(waits[0]).toBeLessThanOrEqual(1250);
    expect(waits[1]).toBeGreaterThanOrEqual(1500);
    expect(waits[1]).toBeLessThanOrEqual(2500);
  });

  it('recupera numa nova tentativa', async () => {
    const f = fakeFetch([{ status: 502, body: '' }, { body: raw('empty.json') }]);
    const book = await fetchOrderBook('PTFCP0AM0008', 'XLIS', opts(f.impl));
    expect(book.bids).toEqual([]);
  });

  it('HTTP 404 ou HTML em vez de JSON → InstrumentNotFoundError', async () => {
    for (const r of [{ status: 404, body: 'not found' }, { body: raw('html-error.html'), type: 'text/html' }]) {
      clearCache();
      const err = await fetchOrderBook('PTFCP0AM0008', 'XLIS', opts(fakeFetch([r]).impl)).catch((e) => e);
      expect(err).toBeInstanceOf(InstrumentNotFoundError);
      expect(err.url).toContain('PTFCP0AM0008-XLIS');
    }
  });
});

describe('watchOrderBook', () => {
  beforeEach(() => clearCache());

  it('força o intervalo mínimo de 30 s e só notifica quando o livro muda', async () => {
    const bodies = [raw('ptfcp0am0008-xlis.json'), raw('ptfcp0am0008-xlis.json'), raw('crossed.json')];
    let i = 0;
    const impl = async () => new Response(bodies[Math.min(i++, bodies.length - 1)], { status: 200 });
    const timers = [];
    const updates = [];
    const w = watchOrderBook('PTFCP0AM0008', 'XLIS', 5, (b) => updates.push(b), {
      fetchImpl: impl, cache: false, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    });
    expect(w.intervalMs).toBe(30_000);
    await new Promise((r) => setTimeout(r, 10));
    for (let k = 0; k < 2; k++) {
      await timers.at(-1).fn();
    }
    expect(timers.every((t) => t.ms === 30_000)).toBe(true);
    expect(updates).toHaveLength(2); // 1.ª resposta, 2.ª igual (ignorada), 3.ª diferente
    w.stop();
  });

  it('erros transitórios vão para onError e não param o ciclo', async () => {
    const errors = [];
    const timers = [];
    watchOrderBook('PTFCP0AM0008', 'XLIS', 60, () => {}, {
      fetchImpl: async () => { throw new TypeError('rede'); }, retries: 0, cache: false, sleep: async () => {},
      onError: (e) => errors.push(e), setTimer: (fn, ms) => { timers.push(ms); return 1; }, clearTimer: () => {},
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(errors[0]).toBeInstanceOf(UpstreamError);
    expect(timers).toEqual([60_000]);
  });
});
