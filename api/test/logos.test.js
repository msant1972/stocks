import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser } from '../src/services/users.js';
import { CLIENT_ID } from '../src/routes/logos.js';
import { api, enableMfa, FAST_HASH, hasTestDb, login, makeUser, PASSWORD, setup } from './helpers.js';

describe('chave de cliente', () => {
  it('aceita só letras, algarismos, - e _', () => {
    expect(CLIENT_ID.test('1idAbC_9-xyz')).toBe(true);
    for (const bad of ['curta', 'com espaço1', 'a&b=c12345', '"><script>', 'x'.repeat(65)]) expect(CLIENT_ID.test(bad)).toBe(false);
  });
});

describe.skipIf(!hasTestDb)('logotipos (Brandfetch)', () => {
  let ctx; let admin; let ana;
  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.testNoRateLimit = true;
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    await enableMfa(ctx.pool, await createUser(ctx.pool, { email: 'adm@exemplo.pt', name: 'Admin', password: PASSWORD, isAdmin: true }, FAST_HASH));
    admin = api(ctx.app, await login(ctx.app, 'adm@exemplo.pt'));
  });
  afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

  it('sem chave: clientId nulo', async () => {
    expect((await ana.get('/logos/config')).json()).toMatchObject({ provider: 'brandfetch', clientId: null, enabled: true });
  });

  it('interruptor global: só administradores; a chave mantém-se', async () => {
    expect((await ana.put('/admin/logos/enabled', { enabled: false })).statusCode).toBe(403);
    await admin.put('/admin/logos', { clientId: 'abcdefgh12' });
    expect((await admin.put('/admin/logos/enabled', { enabled: false })).json()).toMatchObject({ enabled: false, clientId: 'abcdefgh12' });
    expect((await ana.get('/logos/config')).json().enabled).toBe(false);
    expect((await admin.put('/admin/logos/enabled', { enabled: true })).json().enabled).toBe(true);
    await admin.del('/admin/logos');
    await ctx.pool.query("DELETE FROM audit_log WHERE action LIKE 'admin.logos%'");
  });

  it('só administradores guardam e apagam; todos lêem', async () => {
    expect((await ana.put('/admin/logos', { clientId: 'abcdefgh12' })).statusCode).toBe(403);
    expect((await admin.put('/admin/logos', { clientId: 'a b' })).statusCode).toBe(400);
    const res = await admin.put('/admin/logos', { clientId: ' abcdefgh12 ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ clientId: 'abcdefgh12', updatedBy: 'Admin' });
    expect((await ana.get('/logos/config')).json().clientId).toBe('abcdefgh12');
    expect((await ana.del('/admin/logos')).statusCode).toBe(403);
    expect((await admin.del('/admin/logos')).json().clientId).toBeNull();
    const [rows] = await ctx.pool.query("SELECT action FROM audit_log WHERE action LIKE 'admin.logos%' ORDER BY id");
    expect(rows.map((r) => r.action)).toEqual(['admin.logos_set', 'admin.logos_remove']);
  });
});

describe.skipIf(!hasTestDb)('logotipos internos', () => {
  let ctx; let admin; let ana; let galp; let semSite;
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
  const upload = (cookie, id, content) => {
    const b = '----stocks-logo';
    return ctx.app.inject({
      method: 'PUT', url: `/api/v1/admin/instruments/${id}/logo`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${b}` },
      payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="l.png"\r\nContent-Type: image/png\r\n\r\n`), content, Buffer.from(`\r\n--${b}--\r\n`)]),
    });
  };
  let adminCookie; let anaCookie;
  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.testNoRateLimit = true;
    const { makeInstrument } = await import('./helpers.js');
    galp = await makeInstrument(ctx.pool, 'GALP.LS', { closes: ['10', '11'] });
    semSite = await makeInstrument(ctx.pool, 'XPTO.LS', { closes: ['10', '11'] });
    for (let k = 0; k < 11; k++) {
      const id = await makeInstrument(ctx.pool, `T${String(k).padStart(2, '0')}.PA`, { closes: ['10', '11'] });
      await ctx.pool.query("INSERT INTO company_profiles (instrument_id, status, website) VALUES (?, 'ok', ?)", [id, `https://www.t${k}.com`]);
    }
    await ctx.pool.query("INSERT INTO company_profiles (instrument_id, status, website) VALUES (?, 'ok', 'https://www.galp.com/pt')", [galp]);
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    anaCookie = await login(ctx.app, 'ana@exemplo.pt');
    ana = api(ctx.app, anaCookie);
    await enableMfa(ctx.pool, await createUser(ctx.pool, { email: 'adm@exemplo.pt', name: 'Admin', password: PASSWORD, isAdmin: true }, FAST_HASH));
    adminCookie = await login(ctx.app, 'adm@exemplo.pt');
    admin = api(ctx.app, adminCookie);
  });
  afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

  it('só administradores; lote de 10 com o domínio; sem site fica de fora', async () => {
    expect((await ana.get('/admin/logos/missing')).statusCode).toBe(403);
    expect((await ana.get('/admin/logos/summary')).statusCode).toBe(403);
    expect((await upload(anaCookie, galp, PNG)).statusCode).toBe(403);
    const { items } = (await admin.get('/admin/logos/missing')).json();
    expect(items).toHaveLength(10);
    expect(items[0]).toMatchObject({ instrumentId: galp, symbol: 'GALP.LS', domain: 'galp.com' });
    expect(items.some((i) => i.instrumentId === semSite)).toBe(false);
    expect((await admin.get('/admin/logos/summary')).json()).toMatchObject({ active: 13, withLogo: 0, missing: 12, notFound: 0, noWebsite: 1, batch: 10 });
  });

  it('guarda, serve e mostra a versão no detalhe e no HeatMap; recusa o que não é imagem', async () => {
    expect((await upload(adminCookie, galp, Buffer.from('<svg/>'))).statusCode).toBe(400);
    const res = await upload(adminCookie, galp, PNG);
    expect(res.statusCode).toBe(200);
    const v = res.json().logoVersion;
    const img = await ana.get(`/instruments/${galp}/logo`);
    expect(img.headers['content-type']).toBe('image/png');
    expect(Buffer.from(img.rawPayload).equals(PNG)).toBe(true);
    expect((await ana.get(`/instruments/${galp}`)).json().logoVersion).toBe(v);
    const hm = (await ana.get('/heatmap?period=1&limit=50')).json().items;
    expect(hm.find((i) => i.instrumentId === galp).logoVersion).toBe(v);
    expect(hm.find((i) => i.instrumentId === semSite).logoVersion).toBeNull();
    expect((await admin.get('/admin/logos/missing')).json().items.some((i) => i.instrumentId === galp)).toBe(false);
  });

  it('não encontrado: sai do lote; «tentar de novo» volta a incluí-lo; não apaga um logotipo existente', async () => {
    const t0 = (await admin.get('/admin/logos/missing')).json().items[0].instrumentId;
    expect((await admin.post(`/admin/instruments/${t0}/logo/not-found`)).statusCode).toBe(204);
    expect((await admin.get('/admin/logos/missing')).json().items.some((i) => i.instrumentId === t0)).toBe(false);
    expect((await admin.get('/admin/logos/missing?retry=true')).json().items.some((i) => i.instrumentId === t0)).toBe(true);
    await admin.post(`/admin/instruments/${galp}/logo/not-found`);
    expect((await ana.get(`/instruments/${galp}/logo`)).statusCode).toBe(200);
    expect((await admin.get('/admin/logos/summary')).json()).toMatchObject({ withLogo: 1, notFound: 1, missing: 10 });
  });

  it('apagar volta a pôr em falta', async () => {
    expect((await admin.del(`/admin/instruments/${galp}/logo`)).statusCode).toBe(204);
    expect((await ana.get(`/instruments/${galp}/logo`)).statusCode).toBe(404);
  });
});
