import { z } from 'zod';
import { burnPasswordCheck, verifyPassword } from '../auth/password.js';
import {
  createSession, destroySession, recordMfaFailure, RESTRICTED_MINUTES, SESSION_COOKIE,
} from '../auth/sessions.js';
import { AppError } from '../errors.js';
import { ErrorBody, User } from '../schemas.js';
import { normaliseEmail, setPassword } from '../services/users.js';
import * as mfa from '../services/mfa.js';
import { audit, withTransaction } from '../db.js';

/** Estado do 2.º factor da sessão: pending diz o que falta ('verify', 'setup') antes do acesso completo. */
const MfaState = z.object({ enabled: z.boolean(), pending: z.enum(['verify', 'setup']).nullable() });
const Session = z.object({ user: User, mfa: MfaState });
const Code = z.string().trim().min(6).max(20);
const RecoveryCodes = z.object({ recoveryCodes: z.array(z.string()) });

const pendingFor = (stage, enabled) => (stage === 'mfa_verify' ? 'verify' : enabled ? null : 'setup');

export default async function authRoutes(app, { pool, cfg, cookieOptions }) {
  const restrictedCookie = { ...cookieOptions, maxAge: RESTRICTED_MINUTES * 60 };
  const codeLimit = { rateLimit: { max: 20, timeWindow: '15 minutes' } };

  /** Código errado: conta na sessão e, ao fim de MAX_MFA_FAILURES, termina-a. */
  async function wrongCode(req, reply) {
    const locked = await recordMfaFailure(pool, req.cookies[SESSION_COOKIE]);
    await audit(pool, req.user.id, 'auth.mfa_failed', 'user', req.user.id, locked ? { locked } : null);
    if (locked) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      throw new AppError(401, 'MFA_LOCKED', 'demasiados códigos errados; inicie sessão de novo');
    }
    return new AppError(400, 'INVALID_CODE', 'código incorrecto ou já utilizado');
  }

  /** Substitui a sessão restrita por uma completa, com token novo. */
  async function upgrade(req, reply) {
    await destroySession(pool, req.cookies[SESSION_COOKIE]);
    const token = await createSession(pool, req.user.id, cfg.sessionDays);
    reply.setCookie(SESSION_COOKIE, token, cookieOptions);
  }

  app.post('/auth/login', {
    config: { public: true, rateLimit: { max: cfg.loginMaxAttempts, timeWindow: '15 minutes' } },
    schema: {
      tags: ['Sessão'], summary: 'Iniciar sessão (1.º passo: palavra-passe)',
      description: 'Cria uma sessão restrita de 15 minutos. O passo seguinte é indicado em mfa.pending: '
        + '"verify" (POST /auth/mfa/verify) ou "setup" (POST /auth/mfa/setup e /auth/mfa/enable).',
      body: z.object({ email: z.string().max(255), password: z.string().max(200) }),
      response: { 200: Session, 401: ErrorBody },
    },
  }, async (req, reply) => {
    const email = normaliseEmail(req.body.email);
    const [[u]] = await pool.query(
      'SELECT id, email, name, is_admin, password_hash, totp_enabled_at FROM users WHERE email = ? AND disabled_at IS NULL',
      [email],
    );
    const ok = u ? await verifyPassword(req.body.password, u.password_hash) : (await burnPasswordCheck(req.body.password), false);
    if (!ok) {
      await audit(pool, u ? u.id : null, 'auth.login_failed', 'user', u?.id ?? null, { email });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'email ou palavra-passe incorrectos');
    }
    const enabled = u.totp_enabled_at != null;
    const stage = enabled ? 'mfa_verify' : 'mfa_setup';
    const token = await createSession(pool, u.id, cfg.sessionDays, stage);
    await audit(pool, u.id, 'auth.login', 'user', u.id, { stage });
    reply.setCookie(SESSION_COOKIE, token, restrictedCookie);
    return {
      user: { id: Number(u.id), email: u.email, name: u.name, isAdmin: Boolean(u.is_admin) },
      mfa: { enabled, pending: pendingFor(stage, enabled) },
    };
  });

  app.post('/auth/mfa/verify', {
    config: { mfa: 'allow', ...codeLimit },
    schema: {
      tags: ['Sessão'], summary: 'Iniciar sessão (2.º passo: código da aplicação ou de recuperação)',
      body: z.object({ code: Code }),
      response: { 200: Session.extend({ recoveryCodesLeft: z.number().nullable() }), 400: ErrorBody, 401: ErrorBody, 409: ErrorBody },
    },
  }, async (req, reply) => {
    if (req.mfa.stage !== 'mfa_verify') throw new AppError(409, 'MFA_NOT_PENDING', 'esta sessão não está à espera de um código');
    const key = mfa.requireKey(cfg);
    const method = await mfa.verifyCode(pool, key, req.user.id, req.body.code);
    if (!method) throw await wrongCode(req, reply);
    await upgrade(req, reply);
    await audit(pool, req.user.id, 'auth.mfa_verified', 'user', req.user.id, { method });
    const left = method === 'recovery' ? (await mfa.mfaStatus(pool, req.user.id)).recoveryCodesLeft : null;
    return { user: req.user, mfa: { enabled: true, pending: null }, recoveryCodesLeft: left };
  });

  // Configuração: na sessão restrita depois do login, ou numa sessão completa anterior à activação do MFA.
  const canSetup = (req) => {
    if (req.mfa.enabled) throw new AppError(409, 'MFA_ALREADY_ENABLED', 'a autenticação em dois passos já está activa');
    if (req.mfa.stage === 'mfa_verify') throw new AppError(409, 'MFA_NOT_PENDING', 'confirme primeiro o código');
  };

  app.post('/auth/mfa/setup', {
    config: { mfa: 'allow', ...codeLimit },
    schema: {
      tags: ['Sessão'], summary: 'Gerar o segredo TOTP e o QR code (ainda por confirmar)',
      response: {
        200: z.object({ secret: z.string(), otpauthUri: z.string(), qrCode: z.string() }),
        409: ErrorBody, 503: ErrorBody,
      },
    },
  }, async (req) => {
    canSetup(req);
    return mfa.startSetup(pool, mfa.requireKey(cfg), req.user);
  });

  app.post('/auth/mfa/enable', {
    config: { mfa: 'allow', ...codeLimit },
    schema: {
      tags: ['Sessão'], summary: 'Confirmar o 1.º código e activar o 2.º factor',
      description: 'Devolve 10 códigos de recuperação, mostrados só desta vez. Termina as outras sessões do utilizador.',
      body: z.object({ code: Code }),
      response: { 200: Session.merge(RecoveryCodes), 400: ErrorBody, 401: ErrorBody, 409: ErrorBody, 503: ErrorBody },
    },
  }, async (req, reply) => {
    canSetup(req);
    const codes = await mfa.enable(pool, mfa.requireKey(cfg), req.user.id, req.body.code);
    if (!codes) throw await wrongCode(req, reply);
    // enable() terminou todas as sessões, incluindo esta: cria-se uma nova, completa.
    const token = await createSession(pool, req.user.id, cfg.sessionDays);
    reply.setCookie(SESSION_COOKIE, token, cookieOptions);
    return { user: req.user, mfa: { enabled: true, pending: null }, recoveryCodes: codes };
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
    config: { mfa: 'allow' },
    schema: { tags: ['Sessão'], summary: 'Utilizador autenticado e estado do 2.º factor', response: { 200: Session } },
  }, async (req) => ({ user: req.user, mfa: { enabled: req.mfa.enabled, pending: pendingFor(req.mfa.stage, req.mfa.enabled) } }));

  app.get('/me/mfa', {
    schema: {
      tags: ['Sessão'], summary: 'Autenticação em dois passos da conta',
      response: { 200: z.object({ enabled: z.boolean(), enabledAt: z.string().nullable(), recoveryCodesLeft: z.number() }) },
    },
  }, async (req) => mfa.mfaStatus(pool, req.user.id));

  app.post('/me/mfa/recovery-codes', {
    config: codeLimit,
    schema: {
      tags: ['Sessão'], summary: 'Gerar códigos de recuperação novos (invalida os anteriores)',
      body: z.object({ code: Code }),
      response: { 200: RecoveryCodes, 400: ErrorBody, 401: ErrorBody },
    },
  }, async (req, reply) => {
    const method = await mfa.verifyCode(pool, mfa.requireKey(cfg), req.user.id, req.body.code);
    if (!method) throw await wrongCode(req, reply);
    return { recoveryCodes: await mfa.regenerateRecoveryCodes(pool, req.user.id) };
  });

  app.post('/me/mfa/reset', {
    config: codeLimit,
    schema: {
      tags: ['Sessão'], summary: 'Trocar de aplicação de autenticação',
      description: 'Pede a palavra-passe e um código. Desliga o 2.º factor, termina todas as sessões e devolve '
        + 'uma sessão restrita para o configurar de novo.',
      body: z.object({ password: z.string().max(200), code: Code }),
      response: { 200: Session, 400: ErrorBody, 401: ErrorBody },
    },
  }, async (req, reply) => {
    const [[u]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!(await verifyPassword(req.body.password, u.password_hash))) {
      throw new AppError(400, 'INVALID_CREDENTIALS', 'a palavra-passe está incorrecta');
    }
    const method = await mfa.verifyCode(pool, mfa.requireKey(cfg), req.user.id, req.body.code);
    if (!method) throw await wrongCode(req, reply);
    await withTransaction(pool, async (conn) => {
      await mfa.resetMfa(conn, req.user.id);
      await audit(conn, req.user.id, 'auth.mfa_reset', 'user', req.user.id, { by: 'self' });
    });
    const token = await createSession(pool, req.user.id, cfg.sessionDays, 'mfa_setup');
    reply.setCookie(SESSION_COOKIE, token, restrictedCookie);
    return { user: req.user, mfa: { enabled: false, pending: 'setup' } };
  });

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
