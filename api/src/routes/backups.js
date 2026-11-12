import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { audit } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { ErrorBody } from '../schemas.js';

const run = promisify(execFile);

/** Nome dos ficheiros que o deploy/bin/backup.sh cria: stocks-AAAAMMDDTHHMMSSZ.sql.gz (UTC). */
export const BACKUP_NAME = /^stocks-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.sql\.gz$/;
const RETENTION_DAYS = 30; // o backup.sh apaga as cópias com mais de 30 dias

const Backup = z.object({
  name: z.string(), size: z.number().describe('Bytes'), createdAt: z.string().describe('Data da cópia (UTC), do nome do ficheiro'),
});

/** Cópias da pasta, da mais recente para a mais antiga; ignora tudo o que não seja um ficheiro com o nome do backup.sh. */
export async function listBackups(dir) {
  let names;
  try { names = await fs.promises.readdir(dir); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const name of names) {
    const m = BACKUP_NAME.exec(name);
    if (!m) continue;
    const st = await fs.promises.stat(path.join(dir, name)).catch(() => null);
    if (!st?.isFile()) continue;
    out.push({ name, size: st.size, createdAt: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` });
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * Cópias de segurança da base de dados, só para administradores: listar, criar agora (corre o deploy/bin/backup.sh, o mesmo
 * do timer diário) e descarregar. Não há restauro pela API: substitui a base toda e faz-se à mão (deploy/README.md).
 * Uma cópia contém os hashes das palavras-passe e os segredos cifrados: o descarregamento é auditado.
 */
export default async function backupRoutes(app, { pool, cfg }) {
  let creating = false;

  app.addHook('preHandler', async (req) => {
    if (!req.user?.isAdmin) throw new AppError(403, 'FORBIDDEN', 'reservado a administradores');
  });

  app.get('/admin/backups', {
    schema: {
      tags: ['Administração'], summary: 'Cópias de segurança da base de dados (da mais recente para a mais antiga)',
      response: {
        200: z.object({
          items: z.array(Backup), retentionDays: z.number(), creating: z.boolean(),
          databaseBytes: z.number().nullable().describe('Tamanho da base de dados (dados e índices), em bytes'),
        }),
        403: ErrorBody,
      },
    },
  }, async () => {
    const [[size]] = await pool.query(
      'SELECT SUM(data_length + index_length) AS bytes FROM information_schema.tables WHERE table_schema = DATABASE()',
    );
    return { items: await listBackups(cfg.backup.dir), retentionDays: RETENTION_DAYS, creating, databaseBytes: size?.bytes == null ? null : Number(size.bytes) };
  });

  app.post('/admin/backups', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: {
      tags: ['Administração'], summary: 'Criar uma cópia de segurança agora',
      description: 'Corre o mesmo script do timer diário (mariadb-dump comprimido para a pasta das cópias). Uma de cada vez: 409 se já está a decorrer.',
      response: { 201: Backup, 403: ErrorBody, 409: ErrorBody, 500: ErrorBody },
    },
  }, async (req, reply) => {
    if (creating) throw new AppError(409, 'BACKUP_RUNNING', 'já está a decorrer uma cópia de segurança');
    creating = true;
    try {
      const before = new Set((await listBackups(cfg.backup.dir)).map((b) => b.name));
      const env = {
        ...process.env, STOCKS_BACKUP_DIR: cfg.backup.dir, STOCKS_DB_HOST: cfg.db.host, STOCKS_DB_PORT: String(cfg.db.port),
        STOCKS_DB_USER: cfg.db.user, STOCKS_DB_PASSWORD: cfg.db.password, STOCKS_DB_NAME: cfg.db.database,
      };
      try {
        await run(cfg.backup.script, [], { env, timeout: 5 * 60_000 });
      } catch (err) {
        req.log.error({ err: err.message, stderr: String(err.stderr ?? '').slice(0, 500) }, 'backup: falhou');
        await audit(pool, req.user.id, 'admin.backup_failed', 'backup', null, { killed: Boolean(err.killed) });
        throw new AppError(500, 'BACKUP_FAILED', err.killed ? 'a cópia demorou demasiado e foi interrompida' : 'não foi possível criar a cópia de segurança (ver os registos da API)');
      }
      const made = (await listBackups(cfg.backup.dir)).find((b) => !before.has(b.name));
      if (!made) throw new AppError(500, 'BACKUP_FAILED', 'a cópia terminou mas o ficheiro não foi encontrado');
      await audit(pool, req.user.id, 'admin.backup_create', 'backup', null, { name: made.name, size: made.size });
      return reply.code(201).send(made);
    } finally {
      creating = false;
    }
  });

  app.get('/admin/backups/:name', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['Administração'], summary: 'Descarregar uma cópia de segurança (.sql.gz)',
      description: 'Contém toda a base de dados, incluindo hashes de palavras-passe e segredos cifrados: guarde-a em local seguro. Auditado.',
      params: z.object({ name: z.string().regex(BACKUP_NAME, 'nome de cópia inválido') }),
      response: { 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req, reply) => {
    const { name } = req.params; // validado contra BACKUP_NAME: sem separadores de pasta
    const file = path.join(cfg.backup.dir, name);
    const st = await fs.promises.stat(file).catch(() => null);
    if (!st?.isFile()) throw notFound('Cópia de segurança');
    await audit(pool, req.user.id, 'admin.backup_download', 'backup', null, { name });
    return reply
      .header('content-type', 'application/gzip')
      .header('content-length', st.size)
      .header('content-disposition', `attachment; filename="${name}"`)
      .header('cache-control', 'no-store')
      .send(fs.createReadStream(file));
  });
}
