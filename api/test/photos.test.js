import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser } from '../src/services/users.js';
import { imageType } from '../src/routes/photos.js';
import { enableMfa, FAST_HASH, hasTestDb, login, makeUser, PASSWORD, setup } from './helpers.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const upload = (ctx, cookie, url, content, filename = 'foto.jpg') => {
  const boundary = '----stocks-foto';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`),
    content, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return ctx.app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
};
const get = (ctx, cookie, url) => ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });

describe('tipo da imagem', () => {
  it('reconhece JPEG, PNG e WebP pelos bytes e recusa o resto', () => {
    expect(imageType(JPEG)).toBe('image/jpeg');
    expect(imageType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]))).toBe('image/png');
    expect(imageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)]))).toBe('image/webp');
    expect(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(imageType(Buffer.alloc(3))).toBeNull();
  });
});

describe.skipIf(!hasTestDb)('fotografia do utilizador', () => {
  let ctx; let adminCookie; let anaCookie; let anaId;
  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.testNoRateLimit = true;
    anaId = await makeUser(ctx.pool, 'ana@exemplo.pt');
    anaCookie = await login(ctx.app, 'ana@exemplo.pt');
    await enableMfa(ctx.pool, await createUser(ctx.pool, { email: 'adm@exemplo.pt', name: 'Admin', password: PASSWORD, isAdmin: true }, FAST_HASH));
    adminCookie = await login(ctx.app, 'adm@exemplo.pt');
  });
  afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

  it('sem fotografia: 404 e photoVersion nulo', async () => {
    expect((await get(ctx, anaCookie, `/users/${anaId}/photo`)).statusCode).toBe(404);
    expect((await get(ctx, anaCookie, '/me')).json().user.photoVersion).toBeNull();
  });

  it('o utilizador muda a sua fotografia; qualquer um a vê, com o tipo certo', async () => {
    const res = await upload(ctx, anaCookie, '/me/photo', JPEG);
    expect(res.statusCode).toBe(200);
    expect(res.json().photoVersion).toBeGreaterThan(0);
    expect((await get(ctx, anaCookie, '/me')).json().user.photoVersion).toBe(res.json().photoVersion);
    const img = await get(ctx, adminCookie, `/users/${anaId}/photo`);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(img.rawPayload).equals(JPEG)).toBe(true);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/users/${anaId}/photo` })).statusCode).toBe(401);
  });

  it('recusa ficheiros que não são imagens e imagens grandes', async () => {
    expect((await upload(ctx, anaCookie, '/me/photo', Buffer.from('<svg onload="x()"></svg>'), 'foto.svg')).statusCode).toBe(400);
    expect((await upload(ctx, anaCookie, '/me/photo', Buffer.concat([JPEG, Buffer.alloc(600 * 1024)]))).statusCode).toBe(400);
  });

  it('só administradores mudam a de outros', async () => {
    const adminId = (await get(ctx, adminCookie, '/me')).json().user.id;
    expect((await upload(ctx, anaCookie, `/admin/users/${adminId}/photo`, JPEG)).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/v1/admin/users/${adminId}/photo`, headers: { cookie: anaCookie } })).statusCode).toBe(403);
    expect((await upload(ctx, adminCookie, `/admin/users/${anaId}/photo`, JPEG)).statusCode).toBe(200);
    expect((await upload(ctx, adminCookie, '/admin/users/999999/photo', JPEG)).statusCode).toBe(404);
  });

  it('aparece na lista de utilizadores e remove-se', async () => {
    const list = (await get(ctx, adminCookie, '/admin/users')).json().items;
    expect(list.find((u) => u.id === anaId).photoVersion).toBeGreaterThan(0);
    const del = await ctx.app.inject({ method: 'DELETE', url: '/api/v1/me/photo', headers: { cookie: anaCookie } });
    expect(del.json()).toEqual({ photoVersion: null });
    expect((await get(ctx, adminCookie, `/users/${anaId}/photo`)).statusCode).toBe(404);
  });
});
