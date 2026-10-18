import { z } from 'zod';
import { burnPasswordCheck, verifyPassword } from '../auth/password.js';
import { createSession, destroySession, SESSION_COOKIE } from '../auth/sessions.js';
import { AppError } from '../errors.js';
import { ErrorBody, User } from '../schemas.js';
import { normaliseEmail, setPassword } from '../services/users.js';
import { audit } from '../db.js';

export default async function authRoutes(app, { pool, cfg, cookieOptions }) {
  app.post('/auth/login', {
    config: { public: true, rateLimit: { max: cfg.loginMaxAttempts, timeWindow: '15 minutes' } },
    schema: {
      tags: ['Sessão'], summary: 'Iniciar sessão',
      body: z.object({ email: z.string().max(255), password: z.string().max(200) }),
      response: { 200: z.object({ user: User }), 401: ErrorBody },
    },
  }, async (req, reply) => {
    const email = normaliseEmail(req.body.email);
    const [[u]] = await pool.query(
      'SELECT id, email, name, is_admin, password_hash FROM users WHERE email = ? AND disabled_at IS NULL',
      [email],
    );
    const ok = u ? await verifyPassword(req.body.password, u.password_hash) : (await burnPasswordCheck(req.body.password), false);
    if (!ok) {
      await audit(pool, u ? u.id : null, 'auth.login_failed', 'user', u?.id ?? null, { email });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'email ou palavra-passe incorrectos');
    }
    const token = await createSession(pool, u.id, cfg.sessionDays);
    await audit(pool, u.id, 'auth.login', 'user', u.id);
    reply.setCookie(SESSION_COOKIE, token, cookieOptions);
    return { user: { id: Number(u.id), email: u.email, name: u.name, isAdmin: Boolean(u.is_admin) } };
  });

  app.post('/auth/logout', {
    config: { public: true },
    schema: { tags: ['Sessão'], summary: 'Terminar sessão', response: { 204: z.null() } },
  }, async (req, reply) => {
    await destroySession(pool, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send(null);
  });

  app.get('/me', {
    schema: { tags: ['Sessão'], summary: 'Utilizador autenticado', response: { 200: z.object({ user: User }) } },
  }, async (req) => ({ user: req.user }));

  app.put('/me/password', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: {
      tags: ['Sessão'], summary: 'Alterar palavra-passe (termina todas as sessões)',
      body: z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }),
      response: { 204: z.null(), 400: ErrorBody, 401: ErrorBody },
    },
  }, async (req, reply) => {
    const [[u]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!(await verifyPassword(req.body.currentPassword, u.password_hash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'a palavra-passe actual está incorrecta');
    }
    await setPassword(pool, req.user.id, req.body.newPassword);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send(null);
  });
}
