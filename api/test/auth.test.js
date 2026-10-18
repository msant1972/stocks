import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, hasTestDb, login, makeUser, PASSWORD, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('autenticação e sessões', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt');
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('recusa pedidos sem sessão', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('recusa credenciais erradas sem revelar se o email existe', async () => {
    for (const email of ['ana@exemplo.pt', 'ninguem@exemplo.pt']) {
      const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'errada-errada' } });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    }
  });

  it('inicia sessão com cookie HttpOnly e SameSite=Strict, e termina-a', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: ' ANA@exemplo.pt ', password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === 'stocks_session');
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
    const cookie = `stocks_session=${c.value}`;

    const me = await api(ctx.app, cookie).get('/me');
    expect(me.json().user.email).toBe('ana@exemplo.pt');

    expect((await api(ctx.app, cookie).post('/auth/logout')).statusCode).toBe(204);
    expect((await api(ctx.app, cookie).get('/me')).statusCode).toBe(401);
  });

  it('não guarda o token em claro', async () => {
    const cookie = await login(ctx.app, 'ana@exemplo.pt');
    const token = cookie.split('=')[1];
    const [rows] = await ctx.pool.query('SELECT token_hash FROM sessions');
    expect(rows.every((r) => r.token_hash !== token && r.token_hash.length === 64)).toBe(true);
  });

  it('alterar a palavra-passe termina as sessões abertas', async () => {
    const cookie = await login(ctx.app, 'ana@exemplo.pt');
    const other = await login(ctx.app, 'ana@exemplo.pt');
    const weak = await api(ctx.app, cookie).put('/me/password', { currentPassword: PASSWORD, newPassword: 'curta' });
    expect(weak.statusCode).toBe(400);
    const res = await api(ctx.app, cookie).put('/me/password', { currentPassword: PASSWORD, newPassword: 'outra-palavra-passe' });
    expect(res.statusCode).toBe(204);
    expect((await api(ctx.app, other).get('/me')).statusCode).toBe(401);
    await login(ctx.app, 'ana@exemplo.pt', 'outra-palavra-passe');
  });

  it('utilizador desactivado não entra', async () => {
    await makeUser(ctx.pool, 'rui@exemplo.pt');
    const cookie = await login(ctx.app, 'rui@exemplo.pt');
    await ctx.pool.query("UPDATE users SET disabled_at = NOW(3) WHERE email = 'rui@exemplo.pt'");
    expect((await api(ctx.app, cookie).get('/me')).statusCode).toBe(401);
  });

  it('recusa pedidos de escrita vindos de outra origem quando a origem pública está configurada', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ pool: ctx.pool, cfg: { ...ctx.cfg, publicOrigin: 'https://stocks.graus.pt' }, logger: false });
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', headers: { origin: 'https://malicioso.example' },
      payload: { email: 'ana@exemplo.pt', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('frontend compilado', () => {
  it('serve ficheiros criados depois do arranque e devolve index.html nas rotas da aplicação', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { buildApp } = await import('../src/app.js');
    const { testConfig } = await import('./helpers.js');
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');
    const app = await buildApp({ pool: null, cfg: { ...testConfig(), frontendDist: dist }, logger: false });
    fs.writeFileSync(path.join(dist, 'assets', 'novo-123.js'), 'export {}');
    const js = await app.inject({ url: '/assets/novo-123.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('javascript');
    expect(js.headers['cache-control']).toContain('immutable');
    expect((await app.inject({ url: '/assets/inexistente.js' })).statusCode).toBe(404);
    const spa = await app.inject({ url: '/carteira' });
    expect(spa.headers['content-type']).toContain('text/html');
    const missing = await app.inject({ url: '/api/v1/nada' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
    await app.close();
    fs.rmSync(dist, { recursive: true });
  });
});
