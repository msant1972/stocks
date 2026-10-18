import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { audit, withTransaction } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { ErrorBody, Id } from '../schemas.js';
import { createUser, normaliseEmail, setPassword } from '../services/users.js';
import { encryptSecret } from '../secrets.js';

const run = promisify(execFile);

const AdminUser = z.object({
  id: z.number(), email: z.string(), name: z.string(), isAdmin: z.boolean(), disabled: z.boolean(),
  createdAt: z.string(), lastSeenAt: z.string().nullable(),
});

const Password = z.string().min(1).max(200);

/** Gestão de utilizadores, reservada a administradores. */
export default async function adminRoutes(app, { pool, cfg }) {
  app.addHook('preHandler', async (req) => {
    if (!req.user?.isAdmin) throw new AppError(403, 'FORBIDDEN', 'reservado a administradores');
  });

  app.get('/admin/users', {
    schema: {
      tags: ['Administração'], summary: 'Listar utilizadores',
      response: { 200: z.object({ items: z.array(AdminUser) }), 403: ErrorBody },
    },
  }, async () => {
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.name, u.is_admin, u.disabled_at, u.created_at,
              (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
         FROM users u ORDER BY u.id`,
    );
    return {
      items: rows.map((u) => ({
        id: Number(u.id), email: u.email, name: u.name, isAdmin: Boolean(u.is_admin), disabled: u.disabled_at != null,
        createdAt: u.created_at.toISOString(), lastSeenAt: u.last_seen_at?.toISOString() ?? null,
      })),
    };
  });

  app.post('/admin/users', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['Administração'], summary: 'Criar utilizador (com carteira virtual)',
      body: z.object({
        email: z.string().trim().email().max(255),
        name: z.string().trim().min(1).max(120),
        password: Password,
        isAdmin: z.boolean().default(false),
        initialCapital: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).optional(),
      }),
      response: { 201: z.object({ id: z.number() }), 400: ErrorBody, 403: ErrorBody, 409: ErrorBody },
    },
  }, async (req, reply) => {
    const id = await createUser(pool, {
      ...req.body, initialCapital: req.body.initialCapital ?? cfg.initialCapital,
    });
    await audit(pool, req.user.id, 'admin.user_create', 'user', id, { email: normaliseEmail(req.body.email), isAdmin: req.body.isAdmin });
    return reply.code(201).send({ id: Number(id) });
  });

  app.put('/admin/users/:id/password', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['Administração'], summary: 'Redefinir a palavra-passe (termina as sessões do utilizador)',
      params: z.object({ id: Id }),
      body: z.object({ password: Password }),
      response: { 204: z.null(), 400: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req, reply) => {
    const { id } = req.params;
    if (id === req.user.id) {
      throw new AppError(400, 'USE_SETTINGS', 'para a sua própria conta, altere a palavra-passe em Definições');
    }
    const [[u]] = await pool.query('SELECT id FROM users WHERE id = ?', [id]);
    if (!u) throw notFound('Utilizador');
    await setPassword(pool, id, req.body.password);
    await audit(pool, req.user.id, 'admin.user_password_reset', 'user', id);
    return reply.code(204).send(null);
  });

  app.delete('/admin/users/:id', {
    schema: {
      tags: ['Administração'], summary: 'Remover utilizador e todos os seus dados (carteira, operações, lista, alertas)',
      params: z.object({ id: Id }),
      response: { 204: z.null(), 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req, reply) => {
    const { id } = req.params;
    if (id === req.user.id) throw new AppError(409, 'CANNOT_DELETE_SELF', 'não pode remover a sua própria conta');
    await withTransaction(pool, async (conn) => {
      const [[u]] = await conn.query('SELECT id, email, is_admin FROM users WHERE id = ? FOR UPDATE', [id]);
      if (!u) throw notFound('Utilizador');
      // Protecção adicional: nunca deixar a aplicação sem administradores activos.
      if (u.is_admin) {
        const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users WHERE is_admin AND disabled_at IS NULL AND id <> ? FOR UPDATE', [id]);
        if (Number(n) === 0) throw new AppError(409, 'LAST_ADMIN', 'não pode remover o último administrador');
      }
      // As chaves estrangeiras apagam em cascata sessões, carteira, operações, posições, lista, alertas e envios.
      await conn.query('DELETE FROM users WHERE id = ?', [id]);
      await audit(conn, req.user.id, 'admin.user_delete', 'user', id, { email: u.email });
    });
    return reply.code(204).send(null);
  });

  // ---------- Configuração SMTP (usada pelo motor de alertas) ----------

  const SmtpSettings = z.object({
    configured: z.boolean(),
    host: z.string().nullable(), port: z.number().nullable(), security: z.enum(['starttls', 'ssl', 'none']).nullable(),
    username: z.string().nullable(), passwordSet: z.boolean(), sender: z.string().nullable(),
    updatedAt: z.string().nullable(), updatedBy: z.string().nullable(),
    canEncrypt: z.boolean(), canTest: z.boolean(),
  });

  async function readSmtp() {
    const [[r]] = await pool.query(
      `SELECT s.host, s.port, s.security, s.username, s.password_enc IS NOT NULL AS password_set, s.sender, s.updated_at, u.email AS updated_by
         FROM smtp_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.id = 1`,
    );
    return {
      configured: Boolean(r), host: r?.host ?? null, port: r?.port ?? null, security: r?.security ?? null,
      username: r?.username ?? null, passwordSet: Boolean(r?.password_set), sender: r?.sender ?? null,
      updatedAt: r?.updated_at?.toISOString() ?? null, updatedBy: r?.updated_by ?? null,
      canEncrypt: Boolean(cfg.secretKey), canTest: Boolean(cfg.alertsPython),
    };
  }

  app.get('/admin/smtp', {
    schema: { tags: ['Administração'], summary: 'Configuração SMTP (sem a palavra-passe)', response: { 200: SmtpSettings, 403: ErrorBody } },
  }, async () => readSmtp());

  app.put('/admin/smtp', {
    schema: {
      tags: ['Administração'], summary: 'Guardar a configuração SMTP usada pelos alertas',
      description: 'password: omitir para manter a actual; string vazia para a apagar.',
      body: z.object({
        host: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9.-]+$/, 'servidor inválido'),
        port: z.coerce.number().int().min(1).max(65535),
        security: z.enum(['starttls', 'ssl', 'none']),
        username: z.string().trim().max(255).optional().transform((v) => v || null),
        password: z.string().max(500).optional(),
        sender: z.string().trim().min(3).max(255).refine((v) => /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/.test(v), 'remetente sem endereço de email válido'),
      }),
      response: { 200: SmtpSettings, 400: ErrorBody, 403: ErrorBody, 409: ErrorBody },
    },
  }, async (req) => {
    const { host, port, security, username, password, sender } = req.body;
    if (password && !cfg.secretKey) {
      throw new AppError(409, 'NO_SECRET_KEY', 'a chave de cifra do servidor não está configurada; não é possível guardar a palavra-passe');
    }
    const cols = ['host', 'port', 'security', 'username', 'sender', 'updated_by'];
    const args = [host, port, security, username, sender, req.user.id];
    // Sem campo password mantém-se a actual; string vazia apaga; caso contrário cifra a nova.
    if (password !== undefined) {
      cols.push('password_enc');
      args.push(password ? encryptSecret(cfg.secretKey, password) : null);
    }
    await pool.query(
      `INSERT INTO smtp_settings (id, ${cols.join(', ')}) VALUES (1, ${cols.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c} = VALUES(${c})`).join(', ')}`,
      args,
    );
    await audit(pool, req.user.id, 'admin.smtp_update', 'smtp_settings', 1, {
      host, port, security, username, sender, password: password === undefined ? 'mantida' : password ? 'alterada' : 'apagada',
    });
    return readSmtp();
  });

  app.post('/admin/smtp/test', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Administração'], summary: 'Enviar um email de teste ao administrador, pelo motor de alertas',
      response: { 200: z.object({ ok: z.boolean(), message: z.string() }), 403: ErrorBody, 501: ErrorBody },
    },
  }, async (req) => {
    if (!cfg.alertsPython) throw new AppError(501, 'TEST_UNAVAILABLE', 'o motor de alertas não está disponível neste servidor');
    try {
      const { stdout } = await run(cfg.alertsPython, ['-m', 'alerts', 'test', '--to', req.user.email], { timeout: 60_000, env: process.env });
      await audit(pool, req.user.id, 'admin.smtp_test', 'smtp_settings', 1, { ok: true });
      return { ok: true, message: stdout.trim().split('\n').at(-1) || 'email de teste enviado' };
    } catch (err) {
      const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim().split('\n').filter(Boolean).at(-1);
      await audit(pool, req.user.id, 'admin.smtp_test', 'smtp_settings', 1, { ok: false });
      return { ok: false, message: err.killed ? 'sem resposta do servidor SMTP (tempo esgotado)' : out || 'falha no envio' };
    }
  });
}
