import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/services/users.js';
import { base32Encode, hotp, stepAt, totp, verifyTotp } from '../src/auth/totp.js';
import {
  api, FAST_HASH, hasTestDb, login, loginPassword, makeUser, PASSWORD, setup, testConfig, TOTP_SECRET,
} from './helpers.js';

describe('TOTP (RFC 6238)', () => {
  it('reproduz os vectores de teste SHA-1 do RFC', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const vectors = [[59, '94287082'], [1111111109, '07081804'], [1234567890, '89005924'], [20000000000, '65353130']];
    for (const [t, code] of vectors) expect(hotp(secret, Math.floor(t / 30), 8)).toBe(code);
  });

  it('aceita ±1 passo e recusa códigos já usados', () => {
    const now = Date.now();
    const prev = totp(TOTP_SECRET, now - 30_000);
    expect(verifyTotp(TOTP_SECRET, prev, { now })).toBe(stepAt(now) - 1);
    expect(verifyTotp(TOTP_SECRET, totp(TOTP_SECRET, now - 90_000), { now })).toBeNull();
    expect(verifyTotp(TOTP_SECRET, totp(TOTP_SECRET, now), { now, lastStep: stepAt(now) })).toBeNull();
    expect(verifyTotp(TOTP_SECRET, 'abcdef', { now })).toBeNull();
  });
});

describe.skipIf(!hasTestDb)('autenticação em dois passos', () => {
  let ctx;
  const inject = (method, url, cookie, payload) => ctx.app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, payload });
  const clearStep = (email) => ctx.pool.query('UPDATE users SET totp_last_step = NULL WHERE email = ?', [email]);

  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    await makeUser(ctx.pool, 'rui@exemplo.pt', '10000.00', { mfa: false });
    await makeUser(ctx.pool, 'eva@exemplo.pt');
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('a palavra-passe só dá uma sessão restrita, que pede o código', async () => {
    const { cookie, body } = await loginPassword(ctx.app, 'ana@exemplo.pt');
    expect(body.mfa).toEqual({ enabled: true, pending: 'verify' });
    expect((await inject('GET', '/me', cookie)).json().mfa.pending).toBe('verify');
    const blocked = await inject('GET', '/portfolio', cookie);
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error.code).toBe('MFA_REQUIRED');
    expect((await inject('POST', '/auth/mfa/setup', cookie)).statusCode).toBe(409);
    const [[s]] = await ctx.pool.query("SELECT TIMESTAMPDIFF(MINUTE, NOW(3), expires_at) AS m FROM sessions WHERE stage = 'mfa_verify' LIMIT 1");
    expect(Number(s.m)).toBeLessThanOrEqual(15);
  });

  it('o código certo troca a sessão por uma completa, com token novo, e não pode ser reutilizado', async () => {
    await clearStep('ana@exemplo.pt');
    const { cookie } = await loginPassword(ctx.app, 'ana@exemplo.pt');
    const code = totp(TOTP_SECRET);
    const res = await inject('POST', '/auth/mfa/verify', cookie, { code });
    expect(res.statusCode).toBe(200);
    const full = `stocks_session=${res.cookies.find((c) => c.name === 'stocks_session').value}`;
    expect(full).not.toBe(cookie);
    expect((await inject('GET', '/me', cookie)).statusCode).toBe(401); // a restrita deixou de existir
    expect((await inject('GET', '/portfolio', full)).statusCode).toBe(200);

    const again = await loginPassword(ctx.app, 'ana@exemplo.pt');
    const replay = await inject('POST', '/auth/mfa/verify', again.cookie, { code });
    expect(replay.json().error.code).toBe('INVALID_CODE');
  });

  it('cinco códigos errados terminam a sessão restrita', async () => {
    const { cookie } = await loginPassword(ctx.app, 'ana@exemplo.pt');
    for (let i = 0; i < 4; i++) expect((await inject('POST', '/auth/mfa/verify', cookie, { code: '000000' })).statusCode).toBe(400);
    const last = await inject('POST', '/auth/mfa/verify', cookie, { code: '000000' });
    expect(last.json().error.code).toBe('MFA_LOCKED');
    expect((await inject('GET', '/me', cookie)).statusCode).toBe(401);
  });

  it('sem 2.º factor, o login obriga a configurá-lo e devolve códigos de recuperação', async () => {
    const { cookie, body } = await loginPassword(ctx.app, 'rui@exemplo.pt');
    expect(body.mfa).toEqual({ enabled: false, pending: 'setup' });
    expect((await inject('GET', '/watchlist', cookie)).json().error.code).toBe('MFA_REQUIRED');
    expect((await inject('POST', '/auth/mfa/verify', cookie, { code: '123456' })).statusCode).toBe(409);

    const setupRes = await inject('POST', '/auth/mfa/setup', cookie);
    expect(setupRes.statusCode).toBe(200);
    const { secret, otpauthUri, qrCode } = setupRes.json();
    expect(otpauthUri).toContain(`secret=${secret}`);
    expect(otpauthUri).toContain('issuer=Stocks');
    expect(qrCode.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const [[u]] = await ctx.pool.query("SELECT totp_pending_enc, totp_enabled_at FROM users WHERE email = 'rui@exemplo.pt'");
    expect(u.totp_pending_enc).toMatch(/^v1:/); // cifrado, nunca em claro
    expect(u.totp_pending_enc).not.toContain(secret);
    expect(u.totp_enabled_at).toBeNull();

    expect((await inject('POST', '/auth/mfa/enable', cookie, { code: '000000' })).json().error.code).toBe('INVALID_CODE');
    const ok = await inject('POST', '/auth/mfa/enable', cookie, { code: totp(secret) });
    expect(ok.statusCode).toBe(200);
    const { recoveryCodes } = ok.json();
    expect(recoveryCodes).toHaveLength(10);
    const full = `stocks_session=${ok.cookies.find((c) => c.name === 'stocks_session').value}`;
    expect((await inject('GET', '/me/mfa', full)).json()).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });

    // Um código de recuperação substitui o da aplicação, uma única vez.
    const r1 = await loginPassword(ctx.app, 'rui@exemplo.pt');
    const viaRecovery = await inject('POST', '/auth/mfa/verify', r1.cookie, { code: recoveryCodes[0].toUpperCase() });
    expect(viaRecovery.statusCode).toBe(200);
    expect(viaRecovery.json().recoveryCodesLeft).toBe(9);
    const r2 = await loginPassword(ctx.app, 'rui@exemplo.pt');
    expect((await inject('POST', '/auth/mfa/verify', r2.cookie, { code: recoveryCodes[0] })).statusCode).toBe(400);
  });

  it('sessões anteriores à activação são obrigadas a configurar o 2.º factor', async () => {
    const id = await makeUser(ctx.pool, 'antigo@exemplo.pt', '10000.00', { mfa: false });
    const { createSession } = await import('../src/auth/sessions.js');
    const cookie = `stocks_session=${await createSession(ctx.pool, id, 7)}`; // sessão 'full' de antes da migração
    const res = await inject('GET', '/portfolio', cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('MFA_SETUP_REQUIRED');
    expect((await inject('GET', '/me', cookie)).json().mfa).toEqual({ enabled: false, pending: 'setup' });
    expect((await inject('POST', '/auth/mfa/setup', cookie)).statusCode).toBe(200);
  });

  it('regenerar códigos de recuperação e trocar de aplicação pedem um código', async () => {
    const eva = api(ctx.app, await login(ctx.app, 'eva@exemplo.pt'));
    expect((await eva.post('/me/mfa/recovery-codes', { code: '000000' })).statusCode).toBe(400);
    await clearStep('eva@exemplo.pt');
    const regen = await eva.post('/me/mfa/recovery-codes', { code: totp(TOTP_SECRET) });
    expect(regen.json().recoveryCodes).toHaveLength(10);

    const wrongPw = await eva.post('/me/mfa/reset', { password: 'errada-errada', code: regen.json().recoveryCodes[0] });
    expect(wrongPw.json().error.code).toBe('INVALID_CREDENTIALS');
    const reset = await eva.post('/me/mfa/reset', { password: PASSWORD, code: regen.json().recoveryCodes[0] });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().mfa).toEqual({ enabled: false, pending: 'setup' });
    expect((await eva.get('/me')).statusCode).toBe(401); // todas as sessões terminadas
    const [[{ n }]] = await ctx.pool.query("SELECT COUNT(*) AS n FROM user_recovery_codes c JOIN users u ON u.id = c.user_id WHERE u.email = 'eva@exemplo.pt'");
    expect(Number(n)).toBe(0);
  });

  it('o administrador pode repor o 2.º factor de outro utilizador', async () => {
    await createUser(ctx.pool, { email: 'admin@exemplo.pt', name: 'Admin', password: PASSWORD, isAdmin: true, initialCapital: '1' }, FAST_HASH);
    const admin = api(ctx.app, await login(ctx.app, 'admin@exemplo.pt'));
    const anaCookie = await login(ctx.app, 'ana@exemplo.pt');
    const users = (await admin.get('/admin/users')).json().items;
    const ana = users.find((u) => u.email === 'ana@exemplo.pt');
    expect(ana.mfaEnabled).toBe(true);
    const self = users.find((u) => u.email === 'admin@exemplo.pt');
    expect((await admin.del(`/admin/users/${self.id}/mfa`)).json().error.code).toBe('USE_SETTINGS');
    expect((await api(ctx.app, anaCookie).del(`/admin/users/${ana.id}/mfa`)).statusCode).toBe(403);

    expect((await admin.del(`/admin/users/${ana.id}/mfa`)).statusCode).toBe(204);
    expect((await api(ctx.app, anaCookie).get('/me')).statusCode).toBe(401);
    expect((await loginPassword(ctx.app, 'ana@exemplo.pt')).body.mfa.pending).toBe('setup');
  });

  it('sem chave de cifra no servidor responde 503 em vez de guardar o segredo em claro', async () => {
    await makeUser(ctx.pool, 'semchave@exemplo.pt', '10000.00', { mfa: false });
    const noKey = await buildApp({ pool: ctx.pool, cfg: { ...testConfig(), secretKey: null }, logger: false });
    const res = await noKey.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'semchave@exemplo.pt', password: PASSWORD } });
    const cookie = `stocks_session=${res.cookies.find((c) => c.name === 'stocks_session').value}`;
    const setupRes = await noKey.inject({ method: 'POST', url: '/api/v1/auth/mfa/setup', headers: { cookie } });
    expect(setupRes.statusCode).toBe(503);
    expect(setupRes.json().error.code).toBe('NO_SECRET_KEY');
    await noKey.close();
  });
});
