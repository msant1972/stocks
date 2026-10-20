import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { clearCache } from '../src/orderbook/index.js';
import { api, hasTestDb, login, makeInstrument, makeUser, setup } from './helpers.js';

const FIXTURE = fs.readFileSync(new URL('./fixtures/orderbook/ptfcp0am0008-xlis.json', import.meta.url), 'utf8');

describe.skipIf(!hasTestDb)('ISIN-MIC no catálogo e livro de ofertas na API', () => {
  let ctx;
  let ana;
  let cookie;
  let id;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    cookie = await login(ctx.app, 'ana@exemplo.pt');
    ana = api(ctx.app, cookie);
    id = await makeInstrument(ctx.pool, 'FCP.LS');
    await ctx.pool.query("UPDATE instruments SET exchange = 'Lisbon' WHERE id = ?", [id]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('define, valida e apaga o ISIN-MIC; sugere o MIC pela bolsa', async () => {
    let item = (await ana.get(`/instruments/${id}`)).json();
    expect(item).toMatchObject({ isinMic: null, suggestedMic: 'XLIS' });
    expect((await ana.put(`/instruments/${id}/isin-mic`, { isinMic: 'ptfcp0am0008-xlis' })).json()).toEqual({ isinMic: 'PTFCP0AM0008-XLIS' });
    item = (await ana.get('/instruments?withIsinMic=true')).json();
    expect(item.items.map((i) => [i.symbol, i.isinMic])).toEqual([['FCP.LS', 'PTFCP0AM0008-XLIS']]);
    const bad = await ana.put(`/instruments/${id}/isin-mic`, { isinMic: 'PTFCP0AM0009-XLIS' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('INVALID_ISIN_MIC');
    expect((await ana.put('/instruments/99999/isin-mic', { isinMic: null })).statusCode).toBe(404);
  });

  it('devolve o livro de ofertas com estatísticas e a fonte', async () => {
    await ana.put(`/instruments/${id}/isin-mic`, { isinMic: 'PTFCP0AM0008-XLIS' });
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(FIXTURE, { status: 200 }));
    const res = await ana.get(`/instruments/${id}/orderbook`);
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(spy.mock.calls[0][0]).toBe('https://live.euronext.com/en/ajax/getOrderBookCanvas/PTFCP0AM0008-XLIS');
    expect(b.instrument).toMatchObject({ symbol: 'FCP.LS', isinMic: 'PTFCP0AM0008-XLIS' });
    expect(b.book).toMatchObject({ delayMinutes: 15, updatedAt: '2026-10-19T15:40:00.000Z' });
    expect(b.book.bids).toHaveLength(2);
    expect(b.stats).toMatchObject({ bestBid: '2.56', bestAsk: '2.8', spread: '0.24', askOrders: 15 });
    expect(b.sourceNote).toBe('Fonte: Euronext, atraso 15 min');
    // Cache de 30 s: um segundo pedido não volta à Euronext.
    await ana.get(`/instruments/${id}/orderbook`);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('resumo de vários livros (mid e desequilíbrio) para as listas, com no máximo 4 pedidos simultâneos', async () => {
    await ana.put(`/instruments/${id}/isin-mic`, { isinMic: 'PTFCP0AM0008-XLIS' });
    const others = [];
    for (let k = 0; k < 6; k++) {
      const oid = await makeInstrument(ctx.pool, `X${k}.LS`);
      await ctx.pool.query("UPDATE instruments SET isin = 'PTGAL0AM0009', mic = ? WHERE id = ?", [`XL${k}A`, oid]);
      others.push(oid);
    }
    const semIsin = await makeInstrument(ctx.pool, 'SAP.DE');
    let active = 0;
    let peak = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      if (String(url).includes('XL0A')) return new Response('<html>não encontrado</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response(FIXTURE, { status: 200 });
    });
    // Dois lotes em simultâneo (como faz o browser com listas grandes): o limite de 4 é global.
    const [res, res2] = await Promise.all([
      ana.get(`/instruments/orderbook-summary?ids=${[id, ...others, semIsin].join(',')}`),
      ana.get(`/instruments/orderbook-summary?ids=${others.join(',')}`),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res2.json().items).toHaveLength(6);
    const items = res.json().items;
    expect(items).toHaveLength(7); // SAP.DE não tem ISIN-MIC
    expect(items.find((i) => i.id === id)).toMatchObject({ mid: '2.68', crossed: false, updatedAt: '2026-10-19T15:40:00.000Z', error: null });
    expect(items.find((i) => i.id === id).imbalance).toBeCloseTo(-0.83, 2);
    expect(items.find((i) => i.id === others[0])).toMatchObject({ mid: null, error: 'NOT_FOUND' });
    expect(peak).toBeLessThanOrEqual(4);
    const many = Array.from({ length: 51 }, (_, k) => k + 1).join(',');
    expect((await ana.get(`/instruments/orderbook-summary?ids=${many}`)).json().error.code).toBe('TOO_MANY_IDS');
    expect((await ana.get('/instruments/orderbook-summary?ids=a,b')).statusCode).toBe(400);
  });

  it('erros: sem ISIN-MIC, instrumento inexistente na Euronext e falha da Euronext', async () => {
    const other = await makeInstrument(ctx.pool, 'SEM.LS');
    expect((await ana.get(`/instruments/${other}/orderbook`)).json().error.code).toBe('NO_ISIN_MIC');
    await ana.put(`/instruments/${id}/isin-mic`, { isinMic: 'PTFCP0AM0008-XLIS' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>not found</html>', { status: 200 }));
    expect((await ana.get(`/instruments/${id}/orderbook`)).json().error.code).toBe('ORDERBOOK_NOT_FOUND');
    clearCache();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('ECONNREFUSED'));
    const r = await ana.get(`/instruments/${id}/orderbook`);
    expect(r.statusCode).toBe(502);
    expect(r.json().error.code).toBe('ORDERBOOK_UPSTREAM');
  }, 20_000);

  it('importação de Excel lê a coluna isin_mic, valida-a e actualiza instrumentos existentes', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Lista');
    ws.addRow(['ticker', 'isin_mic']);
    ws.addRow(['GALP.LS', 'PTGAL0AM0009-XLIS']);
    ws.addRow(['FCP.LS', 'PTFCP0AM0008-XLIS']);
    ws.addRow(['MAU.LS', 'PTGAL0AM0008-XLIS']);
    const boundary = '----isin';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="l.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from(await wb.xlsx.writeBuffer()), Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const prev = await ctx.app.inject({
      method: 'POST', url: '/api/v1/instruments/import/preview', payload: body,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(prev.json().rows.map((r) => [r.symbol, r.status, r.isinMic])).toEqual([
      ['GALP.LS', 'new', 'PTGAL0AM0009-XLIS'], ['FCP.LS', 'exists', 'PTFCP0AM0008-XLIS'], ['MAU.LS', 'error', null],
    ]);
    const res = await ana.post('/instruments', { symbols: ['GALP.LS'], isinMics: { 'GALP.LS': 'PTGAL0AM0009-XLIS' } });
    expect(res.json().results[0].message).toContain('ISIN-MIC actualizado');
    const [[row]] = await ctx.pool.query("SELECT isin, mic FROM instruments WHERE symbol = 'GALP.LS'");
    expect(row).toEqual({ isin: 'PTGAL0AM0009', mic: 'XLIS' });
  });
});
