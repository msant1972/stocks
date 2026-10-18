import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, hasTestDb, login, makeInstrument, makeUser, setup } from './helpers.js';

function multipart(filename, content, contentType) {
  const boundary = '----stocks-teste';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe.skipIf(!hasTestDb)('catálogo, histórico e watchlist', () => {
  let ctx;
  let ana;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    await makeUser(ctx.pool, 'rui@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('adiciona símbolos como pendentes, pede a carga inicial e associa à lista', async () => {
    const res = await ana.post('/instruments', { symbols: ['galp.ls', ' SIE.DE ', 'GALP.LS', 'mau símbolo'] });
    expect(res.statusCode).toBe(200);
    const results = res.json().results;
    expect(results.map((r) => [r.symbol, r.result])).toEqual([
      ['GALP.LS', 'created'], ['SIE.DE', 'created'], ['MAU SÍMBOLO', 'error'],
    ]);
    const [jobs] = await ctx.pool.query("SELECT COUNT(*) AS n FROM fetch_jobs WHERE kind = 'initial' AND status = 'queued'");
    expect(Number(jobs[0].n)).toBe(2);
    const list = await ana.get('/watchlist');
    expect(list.json().items.map((i) => [i.symbol, i.status])).toEqual([['GALP.LS', 'pending'], ['SIE.DE', 'pending']]);

    const again = await ana.post('/instruments', { symbols: ['GALP.LS'] });
    expect(again.json().results[0].result).toBe('exists');
  });

  it('pré-visualiza importação de Excel e de CSV', async () => {
    const cookie = await login(ctx.app, 'ana@exemplo.pt');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Lista');
    ws.addRow(['Nome', 'Ticker']);
    ws.addRow(['Galp', 'GALP.LS']);
    ws.addRow(['ASML', 'asml.as']);
    ws.addRow(['Repetido', 'ASML.AS']);
    ws.addRow(['Mau', 'x y']);
    const xlsx = multipart('lista.xlsx', Buffer.from(await wb.xlsx.writeBuffer()),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/instruments/import/preview', headers: { ...xlsx.headers, cookie }, payload: xlsx.body });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows.map((r) => [r.line, r.symbol, r.status])).toEqual([
      [2, 'GALP.LS', 'exists'], [3, 'ASML.AS', 'new'], [4, 'ASML.AS', 'duplicate'], [5, 'X Y', 'error'],
    ]);
    const [[{ n }]] = await ctx.pool.query("SELECT COUNT(*) AS n FROM instruments WHERE symbol = 'ASML.AS'");
    expect(Number(n)).toBe(0);

    const csv = multipart('lista.csv', Buffer.from('﻿ticker;nome\nTTE.PA;Total\n'), 'text/csv');
    const r2 = await ctx.app.inject({ method: 'POST', url: '/api/v1/instruments/import/preview', headers: { ...csv.headers, cookie }, payload: csv.body });
    expect(r2.json().summary).toEqual({ new: 1, exists: 0, duplicate: 0, error: 0 });

    const bad = multipart('lista.pdf', Buffer.from('x'), 'application/pdf');
    const r3 = await ctx.app.inject({ method: 'POST', url: '/api/v1/instruments/import/preview', headers: { ...bad.headers, cookie }, payload: bad.body });
    expect(r3.statusCode).toBe(400);
    expect(r3.json().error.code).toBe('INVALID_FILE');
  });

  it('disponibiliza o modelo de importação', async () => {
    const res = await ana.get('/instruments/import/template');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload);
    expect(wb.worksheets[0].getRow(1).getCell(1).value).toBe('ticker');
  });

  it('pesquisa, detalhe, histórico com cobertura real e variação diária', async () => {
    const id = await makeInstrument(ctx.pool, 'EDP.LS', { closes: ['4.00', '4.10', '4.00', '4.20'] });
    const search = await ana.get('/instruments?q=edp');
    const item = search.json().items[0];
    expect(item.symbol).toBe('EDP.LS');
    expect(item.latest.close).toBe('4.200000');
    expect(item.latest.changePct).toBe('5.00');

    const detail = await ana.get(`/instruments/${id}`);
    expect(detail.json().sessions).toBe(4);

    const hist = await ana.get(`/instruments/${id}/quotes`);
    expect(hist.statusCode).toBe(200);
    expect(hist.json().quotes).toHaveLength(4);
    expect(hist.json().quotes[0].date < hist.json().quotes[3].date).toBe(true);

    expect((await ana.get('/instruments/999999')).statusCode).toBe(404);
    expect((await ana.get('/instruments/abc')).statusCode).toBe(400);
  });

  it('a lista de acompanhamento é privada de cada utilizador', async () => {
    const id = await makeInstrument(ctx.pool, 'BCP.LS');
    expect((await ana.post('/watchlist/items', { instrumentId: id })).statusCode).toBe(204);
    const rui = api(ctx.app, await login(ctx.app, 'rui@exemplo.pt'));
    expect((await rui.get('/watchlist')).json().items).toHaveLength(0);
    expect((await rui.del(`/watchlist/items/${id}`)).statusCode).toBe(404);
    expect((await ana.del(`/watchlist/items/${id}`)).statusCode).toBe(204);
  });
});

describe.skipIf(!hasTestDb)('forçar validação no fornecedor', () => {
  it('repõe na fila os pendentes e sinaliza o motor', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { buildApp } = await import('../src/app.js');
    const { testConfig } = await import('./helpers.js');
    const ctx = await setup();
    const trigger = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trig-')), 'fetch-request');
    const app = await buildApp({ pool: ctx.pool, cfg: { ...testConfig(), fetchTriggerFile: trigger }, logger: false });
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    const ana = api(app, await login(app, 'ana@exemplo.pt'));

    await ana.post('/instruments', { symbols: ['AAA.LS', 'BBB.LS', 'CCC.LS'] });
    expect(fs.existsSync(trigger)).toBe(true); // adicionar símbolos já sinaliza o motor
    fs.rmSync(trigger);
    const [[a], [b], [c]] = await Promise.all(['AAA.LS', 'BBB.LS', 'CCC.LS'].map((s) =>
      ctx.pool.query('SELECT id FROM instruments WHERE symbol = ?', [s]).then(([r]) => r)));
    // AAA: em espera por uma tentativa futura; BBB: falhou; CCC: já activo (não conta).
    await ctx.pool.query("UPDATE fetch_jobs SET next_attempt_at = NOW(3) + INTERVAL 1 HOUR WHERE instrument_id = ?", [a.id]);
    await ctx.pool.query("UPDATE fetch_jobs SET status = 'failed', attempts = 5 WHERE instrument_id = ?", [b.id]);
    await ctx.pool.query("UPDATE instruments SET status = 'active' WHERE id = ?", [c.id]);

    const res = await ana.post('/instruments/fetch', {});
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ queued: 2, started: true });
    expect(fs.existsSync(trigger)).toBe(true);
    const [jobs] = await ctx.pool.query(
      "SELECT instrument_id, status, attempts, next_attempt_at <= NOW(3) AS ready FROM fetch_jobs WHERE instrument_id IN (?, ?)", [a.id, b.id]);
    expect(jobs.every((j) => j.status === 'queued' && j.attempts === 0 && j.ready === 1)).toBe(true);

    // Sem pendentes: nada a fazer, o motor não é sinalizado.
    await ctx.pool.query("UPDATE instruments SET status = 'active'");
    fs.rmSync(trigger);
    expect((await ana.post('/instruments/fetch', {})).json()).toEqual({ queued: 0, started: false });
    expect(fs.existsSync(trigger)).toBe(false);
    await app.close();
    await ctx.app.close();
    await ctx.pool.end();
  });
});
