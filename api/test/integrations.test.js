import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { encryptSecret } from '../src/secrets.js';
import { api, hasTestDb, login, makeUser, setup, TEST_SECRET_KEY } from './helpers.js';

// O fluxo OAuth completo (guardar a aplicação, ligar, renovar) está em saxo.test.js.
describe.skipIf(!hasTestDb)('ligação à SAXO Bank: estado, desligar e cascata', () => {
  let ctx;
  let ana;
  let anaId;
  let ruiId;
  let anaCookie;
  const connectInDb = (userId) => ctx.pool.query(
    `REPLACE INTO user_integration_tokens (user_id, provider, token_enc, environment, auth_kind, refresh_token_enc, expires_at, refresh_expires_at)
     VALUES (?, 'saxo', ?, 'sim', 'oauth', ?, NOW(3) + INTERVAL 20 MINUTE, NOW(3) + INTERVAL 40 MINUTE)`,
    [userId, encryptSecret(TEST_SECRET_KEY, 'acesso'), encryptSecret(TEST_SECRET_KEY, 'refresh')],
  );
  const appInDb = (userId) => ctx.pool.query('REPLACE INTO user_saxo_apps (user_id, app_key, app_secret_enc) VALUES (?, ?, ?)',
    [userId, 'chave-da-app-0001', encryptSecret(TEST_SECRET_KEY, 'segredo-0001')]);

  beforeAll(async () => {
    ctx = await setup();
    anaId = await makeUser(ctx.pool, 'ana@exemplo.pt');
    ruiId = await makeUser(ctx.pool, 'rui@exemplo.pt');
    anaCookie = await login(ctx.app, 'ana@exemplo.pt');
    ana = api(ctx.app, anaCookie);
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('começa sem ligação nem aplicação', async () => {
    expect((await ana.get('/me/integrations/saxo')).json()).toMatchObject({
      configured: false, updatedAt: null, canEncrypt: true, environment: null, kind: null, expired: false, app: null,
    });
  });

  it('o estado nunca devolve tokens nem o segredo; cada utilizador vê só o seu', async () => {
    await appInDb(anaId);
    await connectInDb(anaId);
    const res = await ana.get('/me/integrations/saxo');
    expect(res.json()).toMatchObject({ configured: true, kind: 'oauth', expired: false, app: { appKey: 'chave-da-app-0001', hasSecret: true } });
    expect(res.body).not.toMatch(/acesso|refresh|segredo-0001/);
    const rui = api(ctx.app, await login(ctx.app, 'rui@exemplo.pt'));
    expect((await rui.get('/me/integrations/saxo')).json()).toMatchObject({ configured: false, app: null });
  });

  it('sem a chave de cifra do servidor não guarda a aplicação nem liga', async () => {
    const app = await buildApp({ pool: ctx.pool, cfg: { ...ctx.cfg, secretKey: null }, logger: false });
    try {
      const noKey = api(app, anaCookie); // a sessão está na BD: o mesmo cookie serve
      expect((await noKey.get('/me/integrations/saxo')).json()).toMatchObject({ canEncrypt: false, canConnect: false });
      expect((await noKey.put('/me/integrations/saxo/app', { appKey: 'chave-da-app-0001', appSecret: 'segredo-0002' })).json().error.code).toBe('NO_SECRET_KEY');
      expect((await noKey.post('/me/integrations/saxo/connect', {})).json().error.code).toBe('NO_SECRET_KEY');
    } finally {
      await app.close();
    }
  });

  it('recusa chaves e segredos com formato inválido', async () => {
    for (const body of [{ appKey: 'curta', appSecret: 'segredo-0002' }, { appKey: 'com espaço 0001', appSecret: 'segredo-0002' },
      { appKey: 'chave-da-app-0001', appSecret: 'com espaço' }, {}]) {
      expect((await ana.put('/me/integrations/saxo/app', body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('desligar remove os tokens (só a primeira vez fica na auditoria) e mantém a aplicação', async () => {
    expect((await ana.del('/me/integrations/saxo')).statusCode).toBe(204);
    expect((await ana.del('/me/integrations/saxo')).statusCode).toBe(204);
    expect((await ana.get('/me/integrations/saxo')).json()).toMatchObject({ configured: false, app: { appKey: 'chave-da-app-0001' } });
    const [[{ n }]] = await ctx.pool.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'integration.token_remove'");
    expect(Number(n)).toBe(1);
  });

  it('apagar o utilizador apaga a sua ligação e a sua aplicação', async () => {
    await appInDb(ruiId);
    await connectInDb(ruiId);
    await ctx.pool.query("DELETE FROM users WHERE email = 'rui@exemplo.pt'");
    const [[t]] = await ctx.pool.query('SELECT COUNT(*) AS n FROM user_integration_tokens WHERE user_id = ?', [ruiId]);
    const [[a]] = await ctx.pool.query('SELECT COUNT(*) AS n FROM user_saxo_apps WHERE user_id = ?', [ruiId]);
    expect([Number(t.n), Number(a.n)]).toEqual([0, 0]);
  });
});
