import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/services/users.js';
import { decryptSecret, encryptSecret } from '../src/secrets.js';
import { api, FAST_HASH, hasTestDb, login, makeUser, PASSWORD, setup, testConfig } from './helpers.js';

const KEY = Buffer.alloc(32, 7);

describe('cifra de segredos', () => {
  it('produz o vector partilhado com o motor de alertas e decifra-o', () => {
    const v = encryptSecret(KEY, 'palavra-passe-smtp', Buffer.alloc(12, 1));
    expect(v).toBe('v1:AQEBAQEBAQEBAQEBUiNQ+Wgsb4ICwrk7S7rESAaA5dbmzY0jobWvUhUaA1zciw==');
    expect(decryptSecret(KEY, v)).toBe('palavra-passe-smtp');
    expect(encryptSecret(KEY, 'x')).not.toBe(encryptSecret(KEY, 'x')); // iv aleatório
  });
});

describe.skipIf(!hasTestDb)('configuração SMTP', () => {
  let ctx;
  let app;
  let admin;
  beforeAll(async () => {
    ctx = await setup();
    app = await buildApp({ pool: ctx.pool, cfg: { ...testConfig(), secretKey: KEY }, logger: false });
    await createUser(ctx.pool, { email: 'admin@exemplo.pt', name: 'Admin', password: PASSWORD, isAdmin: true, initialCapital: '1' }, FAST_HASH);
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    admin = api(app, await login(app, 'admin@exemplo.pt'));
  });
  afterAll(async () => {
    await app.close();
    await ctx.app.close();
    await ctx.pool.end();
  });

  const body = { host: 'smtp.exemplo.pt', port: 587, security: 'starttls', username: 'alertas', sender: 'Stocks <alertas@exemplo.pt>' };

  it('só administradores', async () => {
    const ana = api(app, await login(app, 'ana@exemplo.pt'));
    expect((await ana.get('/admin/smtp')).statusCode).toBe(403);
    expect((await ana.put('/admin/smtp', { ...body, password: 'x' })).statusCode).toBe(403);
  });

  it('começa por configurar', async () => {
    expect((await admin.get('/admin/smtp')).json()).toMatchObject({ configured: false, passwordSet: false, canEncrypt: true, canTest: false });
  });

  it('guarda a palavra-passe cifrada e nunca a devolve', async () => {
    const res = await admin.put('/admin/smtp', { ...body, password: 'segredo-smtp' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: true, host: 'smtp.exemplo.pt', port: 587, passwordSet: true, updatedBy: 'admin@exemplo.pt' });
    expect(JSON.stringify(res.json())).not.toContain('segredo-smtp');
    const [[row]] = await ctx.pool.query('SELECT password_enc FROM smtp_settings WHERE id = 1');
    expect(row.password_enc.startsWith('v1:')).toBe(true);
    expect(decryptSecret(KEY, row.password_enc)).toBe('segredo-smtp');
    const [[aud]] = await ctx.pool.query("SELECT detail FROM audit_log WHERE action = 'admin.smtp_update' ORDER BY id DESC LIMIT 1");
    expect(aud.detail).not.toContain('segredo-smtp');
  });

  it('sem campo password mantém; vazio apaga', async () => {
    await admin.put('/admin/smtp', { ...body, port: 2525 });
    let [[row]] = await ctx.pool.query('SELECT port, password_enc FROM smtp_settings WHERE id = 1');
    expect(row.port).toBe(2525);
    expect(decryptSecret(KEY, row.password_enc)).toBe('segredo-smtp');
    await admin.put('/admin/smtp', { ...body, password: '' });
    [[row]] = await ctx.pool.query('SELECT password_enc FROM smtp_settings WHERE id = 1');
    expect(row.password_enc).toBeNull();
  });

  it('valida os campos', async () => {
    expect((await admin.put('/admin/smtp', { ...body, port: 70000 })).statusCode).toBe(400);
    expect((await admin.put('/admin/smtp', { ...body, security: 'tls13' })).statusCode).toBe(400);
    expect((await admin.put('/admin/smtp', { ...body, sender: 'sem email' })).statusCode).toBe(400);
    expect((await admin.put('/admin/smtp', { ...body, host: 'smtp exemplo' })).statusCode).toBe(400);
  });

  it('sem chave de cifra recusa guardar palavra-passe', async () => {
    const noKey = await buildApp({ pool: ctx.pool, cfg: { ...testConfig(), secretKey: null }, logger: false });
    const a = api(noKey, await login(noKey, 'admin@exemplo.pt'));
    expect((await a.put('/admin/smtp', { ...body, password: 'x' })).json().error.code).toBe('NO_SECRET_KEY');
    expect((await a.post('/admin/smtp/test')).statusCode).toBe(501);
    await noKey.close();
  });
});
