import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser } from '../src/services/users.js';
import { api, FAST_HASH, hasTestDb, login, makeInstrument, makeUser, PASSWORD, recentSessions, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('gestão de utilizadores', () => {
  let ctx;
  let admin;
  let adminId;
  beforeAll(async () => {
    ctx = await setup();
    adminId = await createUser(ctx.pool, { email: 'admin@exemplo.pt', name: 'Admin', password: PASSWORD, isAdmin: true, initialCapital: '10000' }, FAST_HASH);
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    admin = api(ctx.app, await login(ctx.app, 'admin@exemplo.pt'));
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('só administradores têm acesso', async () => {
    const ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    expect((await ana.get('/admin/users')).statusCode).toBe(403);
    expect((await ana.post('/admin/users', { email: 'x@y.pt', name: 'X', password: 'palavra-passe-longa' })).statusCode).toBe(403);
  });

  it('lista os utilizadores', async () => {
    const items = (await admin.get('/admin/users')).json().items;
    expect(items.map((u) => [u.email, u.isAdmin])).toEqual([['admin@exemplo.pt', true], ['ana@exemplo.pt', false]]);
    expect(items[0].lastSeenAt).not.toBeNull();
  });

  it('cria utilizador com carteira e valida os dados', async () => {
    const res = await admin.post('/admin/users', { email: ' Rui@Exemplo.pt ', name: 'Rui', password: 'palavra-passe-longa', initialCapital: '5000' });
    expect(res.statusCode).toBe(201);
    const rui = api(ctx.app, await login(ctx.app, 'rui@exemplo.pt', 'palavra-passe-longa'));
    expect((await rui.get('/portfolio')).json().cashBalance).toBe('5000.00');
    expect((await admin.post('/admin/users', { email: 'rui@exemplo.pt', name: 'Rui', password: 'palavra-passe-longa' })).json().error.code).toBe('EMAIL_EXISTS');
    expect((await admin.post('/admin/users', { email: 'novo@exemplo.pt', name: 'N', password: 'curta' })).json().error.code).toBe('WEAK_PASSWORD');
    expect((await admin.post('/admin/users', { email: 'nao-e-email', name: 'N', password: 'palavra-passe-longa' })).statusCode).toBe(400);
  });

  it('exige pelo menos 8 caracteres na palavra-passe', async () => {
    const seven = await admin.post('/admin/users', { email: 'sete@exemplo.pt', name: 'Sete', password: '1234567' });
    expect(seven.json().error).toMatchObject({ code: 'WEAK_PASSWORD', message: 'a palavra-passe deve ter pelo menos 8 caracteres' });
    expect((await admin.post('/admin/users', { email: 'oito@exemplo.pt', name: 'Oito', password: '12345678' })).statusCode).toBe(201);
    await login(ctx.app, 'oito@exemplo.pt', '12345678');
  });

  it('redefine a palavra-passe e termina as sessões do utilizador', async () => {
    const [[ana]] = await ctx.pool.query("SELECT id FROM users WHERE email = 'ana@exemplo.pt'");
    const session = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    expect((await admin.put(`/admin/users/${ana.id}/password`, { password: 'nova-palavra-passe' })).statusCode).toBe(204);
    expect((await session.get('/me')).statusCode).toBe(401);
    await login(ctx.app, 'ana@exemplo.pt', 'nova-palavra-passe');
    expect((await admin.put(`/admin/users/${adminId}/password`, { password: 'nova-palavra-passe' })).json().error.code).toBe('USE_SETTINGS');
    expect((await admin.put('/admin/users/9999/password', { password: 'nova-palavra-passe' })).statusCode).toBe(404);
  });

  it('remove o utilizador e todos os seus dados, mas não a própria conta', async () => {
    const [[ana]] = await ctx.pool.query("SELECT id FROM users WHERE email = 'ana@exemplo.pt'");
    const anaApi = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt', 'nova-palavra-passe'));
    const inst = await makeInstrument(ctx.pool, 'GALP.LS', { closes: ['10'], sessions: recentSessions(1) });
    await anaApi.post('/watchlist/items', { instrumentId: inst });
    await anaApi.post('/alerts', { instrumentId: inst, kind: 'close_above', threshold: '20' });
    await anaApi.post('/simulated-trades', { instrumentId: inst, side: 'buy', quantity: 1, idempotencyKey: 'chave-de-teste-1' });

    expect((await admin.del(`/admin/users/${ana.id}`)).statusCode).toBe(204);
    for (const t of ['portfolios', 'watchlist_items', 'alert_rules', 'sessions']) {
      const [[{ n }]] = await ctx.pool.query(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, [ana.id]);
      expect(Number(n)).toBe(0);
    }
    const [[{ trades }]] = await ctx.pool.query('SELECT COUNT(*) AS trades FROM simulated_trades');
    expect(Number(trades)).toBe(0);
    expect((await admin.del(`/admin/users/${ana.id}`)).statusCode).toBe(404);
    expect((await admin.del(`/admin/users/${adminId}`)).json().error.code).toBe('CANNOT_DELETE_SELF');

    // Um administrador pode remover outro (fica sempre pelo menos ele próprio como administrador).
    await createUser(ctx.pool, { email: 'admin2@exemplo.pt', name: 'Admin 2', password: PASSWORD, isAdmin: true, initialCapital: '1' }, FAST_HASH);
    const admin2 = api(ctx.app, await login(ctx.app, 'admin2@exemplo.pt'));
    expect((await admin2.del(`/admin/users/${adminId}`)).statusCode).toBe(204);
    expect((await admin2.get('/admin/users')).json().items.map((u) => u.email)).not.toContain('admin@exemplo.pt');
  });
});
