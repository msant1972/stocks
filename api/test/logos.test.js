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
    expect((await ana.get('/logos/config')).json()).toMatchObject({ provider: 'brandfetch', clientId: null });
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
