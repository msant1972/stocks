import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser } from '../src/services/users.js';
import { api, enableMfa, FAST_HASH, hasTestDb, login, makeUser, PASSWORD, setup } from './helpers.js';
import { BACKUP_NAME } from '../src/routes/backups.js';

describe('nome das cópias', () => {
  it('só aceita os nomes do backup.sh, sem separadores de pasta', () => {
    expect(BACKUP_NAME.test('stocks-20261112T033003Z.sql.gz')).toBe(true);
    for (const bad of ['../stocks-20261112T033003Z.sql.gz', 'stocks-20261112T033003Z.sql.gz.part', 'x.sql.gz', 'stocks-2026.sql.gz', '/etc/passwd']) {
      expect(BACKUP_NAME.test(bad)).toBe(false);
    }
  });
});

describe.skipIf(!hasTestDb)('cópias de segurança (administradores)', () => {
  let ctx;
  let admin;
  let ana;
  let dir;
  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.testNoRateLimit = true;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-backups-'));
    // Script de teste: faz o mesmo que o backup.sh (ficheiro com o nome da hora UTC), sem a base de dados.
    const script = path.join(dir, 'fake-backup.sh');
    fs.writeFileSync(script, '#!/bin/sh\nf="$STOCKS_BACKUP_DIR/stocks-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"\nprintf "dump" > "$f"\n', { mode: 0o755 });
    fs.mkdirSync(path.join(dir, 'cop'));
    ctx.cfg.backup = { dir: path.join(dir, 'cop'), script };
    fs.writeFileSync(path.join(dir, 'cop', 'stocks-20261101T033000Z.sql.gz'), 'antiga');
    fs.writeFileSync(path.join(dir, 'cop', 'stocks-20261101T033000Z.sql.gz.part'), 'incompleta'); // ignorada
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    await enableMfa(ctx.pool, await createUser(ctx.pool, { email: 'adm@exemplo.pt', name: 'Admin', password: PASSWORD, isAdmin: true }, FAST_HASH));
    admin = api(ctx.app, await login(ctx.app, 'adm@exemplo.pt'));
  });
  afterAll(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('só administradores', async () => {
    expect((await ana.get('/admin/backups')).statusCode).toBe(403);
    expect((await ana.post('/admin/backups')).statusCode).toBe(403);
    expect((await ana.get('/admin/backups/stocks-20261101T033000Z.sql.gz')).statusCode).toBe(403);
  });

  it('lista só as cópias completas, da mais recente para a mais antiga', async () => {
    const res = (await admin.get('/admin/backups')).json();
    expect(res).toMatchObject({ retentionDays: 30, creating: false });
    expect(res.databaseBytes).toBeGreaterThan(0);
    expect(res.items).toEqual([{ name: 'stocks-20261101T033000Z.sql.gz', size: 6, createdAt: '2026-11-01T03:30:00.000Z' }]);
  });

  it('cria uma cópia agora, audita-a e a lista passa a mostrá-la', async () => {
    const res = await admin.post('/admin/backups');
    expect(res.statusCode).toBe(201);
    const made = res.json();
    expect(made.name).toMatch(BACKUP_NAME);
    expect(made.size).toBe(4);
    const list = (await admin.get('/admin/backups')).json().items.map((b) => b.name);
    expect(list[0]).toBe(made.name);
    expect(list).toHaveLength(2);
    const [rows] = await ctx.pool.query("SELECT detail FROM audit_log WHERE action = 'admin.backup_create'");
    expect(JSON.parse(rows[0].detail)).toMatchObject({ name: made.name });
  });

  it('descarrega uma cópia (auditado) e recusa nomes inválidos ou inexistentes', async () => {
    const res = await admin.get('/admin/backups/stocks-20261101T033000Z.sql.gz');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('antiga');
    expect(res.headers['content-disposition']).toBe('attachment; filename="stocks-20261101T033000Z.sql.gz"');
    expect(res.headers['content-type']).toBe('application/gzip');
    const [rows] = await ctx.pool.query("SELECT COUNT(*) n FROM audit_log WHERE action = 'admin.backup_download'");
    expect(Number(rows[0].n)).toBe(1);
    expect((await admin.get('/admin/backups/stocks-20200101T000000Z.sql.gz')).statusCode).toBe(404);
    expect((await admin.get('/admin/backups/..%2F..%2Fetc%2Fpasswd')).statusCode).toBe(400);
    expect((await admin.get('/admin/backups/passwd')).statusCode).toBe(400);
  });

  it('uma cópia que falha dá erro sem pormenores e fica auditada', async () => {
    const bad = path.join(dir, 'bad.sh');
    fs.writeFileSync(bad, '#!/bin/sh\necho "segredo: palavra-passe errada" >&2\nexit 2\n', { mode: 0o755 });
    const good = ctx.cfg.backup.script;
    ctx.cfg.backup.script = bad;
    const res = await admin.post('/admin/backups');
    ctx.cfg.backup.script = good;
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('BACKUP_FAILED');
    expect(res.body).not.toMatch(/segredo|palavra-passe errada/);
    const [rows] = await ctx.pool.query("SELECT COUNT(*) n FROM audit_log WHERE action = 'admin.backup_failed'");
    expect(Number(rows[0].n)).toBe(1);
  });
});
