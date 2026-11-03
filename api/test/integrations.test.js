import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { decryptSecret } from '../src/secrets.js';
import { api, hasTestDb, login, makeUser, setup, TEST_SECRET_KEY } from './helpers.js';

const TOKEN = 'eyJhbGciOi.JIUzI1NiIs-InR5cCI_6Ik';

describe.skipIf(!hasTestDb)('token da SAXO Bank', () => {
  let ctx;
  let ana;
  let rui;
  let anaCookie;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    await makeUser(ctx.pool, 'rui@exemplo.pt');
    anaCookie = await login(ctx.app, 'ana@exemplo.pt');
    ana = api(ctx.app, anaCookie);
    rui = api(ctx.app, await login(ctx.app, 'rui@exemplo.pt'));
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('começa sem token', async () => {
    expect((await ana.get('/me/integrations/saxo')).json()).toEqual({ configured: false, updatedAt: null, canEncrypt: true });
  });

  it('guarda o token cifrado e nunca o devolve', async () => {
    const res = await ana.put('/me/integrations/saxo', { token: `  ${TOKEN}  ` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: true, canEncrypt: true });
    expect(res.body).not.toContain(TOKEN);
    expect((await ana.get('/me/integrations/saxo')).body).not.toContain(TOKEN);

    const [[row]] = await ctx.pool.query("SELECT token_enc FROM user_integration_tokens WHERE provider = 'saxo'");
    expect(row.token_enc).toMatch(/^v1:/);
    expect(row.token_enc).not.toContain(TOKEN);
    expect(decryptSecret(TEST_SECRET_KEY, row.token_enc)).toBe(TOKEN);

    // Auditoria sem o token.
    const [audit] = await ctx.pool.query("SELECT detail FROM audit_log WHERE action = 'integration.token_set'");
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).not.toContain(TOKEN);
  });

  it('um novo token substitui o anterior; cada utilizador vê só o seu', async () => {
    expect((await ana.put('/me/integrations/saxo', { token: 'outro-token-2' })).statusCode).toBe(200);
    const [rows] = await ctx.pool.query("SELECT token_enc FROM user_integration_tokens WHERE provider = 'saxo'");
    expect(rows).toHaveLength(1);
    expect(decryptSecret(TEST_SECRET_KEY, rows[0].token_enc)).toBe('outro-token-2');
    expect((await rui.get('/me/integrations/saxo')).json().configured).toBe(false);
  });

  it('recusa tokens vazios ou com espaços', async () => {
    for (const token of ['', '   ', 'com espaço', 'acentuação']) {
      expect((await ana.put('/me/integrations/saxo', { token })).statusCode).toBe(400);
    }
    expect((await ana.put('/me/integrations/saxo', {})).statusCode).toBe(400);
  });

  it('sem a chave de cifra do servidor não guarda o token', async () => {
    const app = await buildApp({ pool: ctx.pool, cfg: { ...ctx.cfg, secretKey: null }, logger: false });
    try {
      const noKey = api(app, anaCookie); // a sessão está na BD: o mesmo cookie serve
      expect((await noKey.get('/me/integrations/saxo')).json().canEncrypt).toBe(false);
      const res = await noKey.put('/me/integrations/saxo', { token: TOKEN });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('NO_SECRET_KEY');
    } finally {
      await app.close();
    }
  });

  it('remove o token, e removê-lo outra vez não dá erro', async () => {
    expect((await ana.del('/me/integrations/saxo')).statusCode).toBe(204);
    expect((await ana.get('/me/integrations/saxo')).json().configured).toBe(false);
    expect((await ana.del('/me/integrations/saxo')).statusCode).toBe(204);
    const [audit] = await ctx.pool.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'integration.token_remove'");
    expect(Number(audit[0].n)).toBe(1); // só a remoção que apagou alguma coisa
  });

  it('apagar o utilizador apaga o seu token', async () => {
    expect((await rui.put('/me/integrations/saxo', { token: TOKEN })).statusCode).toBe(200);
    await ctx.pool.query("DELETE FROM users WHERE email = 'rui@exemplo.pt'");
    const [[{ n }]] = await ctx.pool.query('SELECT COUNT(*) AS n FROM user_integration_tokens');
    expect(Number(n)).toBe(0);
  });
});
