import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  hasZodFastifySchemaValidationErrors, isResponseSerializationError,
  jsonSchemaTransform, serializerCompiler, validatorCompiler,
} from 'fastify-type-provider-zod';
import { resolveSession, SESSION_COOKIE } from './auth/sessions.js';
import { AppError } from './errors.js';
import authRoutes from './routes/auth.js';
import instrumentRoutes from './routes/instruments.js';
import watchlistRoutes from './routes/watchlist.js';
import portfolioRoutes from './routes/portfolio.js';
import alertRoutes from './routes/alerts.js';
import statusRoutes from './routes/status.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp({ pool, cfg, logger = true }) {
  const app = Fastify({
    logger: logger && {
      level: cfg.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    trustProxy: '127.0.0.1',
    bodyLimit: 256 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Só JSON e multipart: um formulário de outro site não consegue enviar text/plain para a API.
  app.removeContentTypeParser('text/plain');

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR', message: 'pedido inválido',
          details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err: err.cause }, 'resposta não corresponde ao esquema');
      return reply.code(500).send({ error: { code: 'INTERNAL', message: 'erro interno' } });
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'demasiados pedidos; tente mais tarde' } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: err.code || 'BAD_REQUEST', message: err.message } });
    }
    req.log.error({ err }, 'erro inesperado');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'erro interno' } });
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 1024 * 1024, files: 1, fields: 5 } });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Stocks API',
        version: '1.0.0',
        description: 'API da plataforma de simulação e acompanhamento de acções. Todas as operações são '
          + 'simuladas e usam cotações diárias, não dados em tempo real. Autenticação por cookie de sessão '
          + `(${SESSION_COOKIE}), obtido em POST /api/v1/auth/login.`,
      },
      components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE } } },
      security: [{ session: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  app.get('/health/live', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/health/ready', { schema: { hide: true } }, async (req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  const cookieOptions = {
    path: '/', httpOnly: true, sameSite: 'strict', secure: cfg.secureCookies, maxAge: cfg.sessionDays * 86_400,
  };

  await app.register(async (api) => {
    api.decorateRequest('user', null);

    api.addHook('onRequest', async (req, reply) => {
      // Defesa adicional contra CSRF, além do cookie SameSite=Strict: a origem tem de ser a da aplicação.
      if (MUTATING.has(req.method) && cfg.publicOrigin && req.headers.origin && req.headers.origin !== cfg.publicOrigin) {
        throw new AppError(403, 'FORBIDDEN_ORIGIN', 'origem não autorizada');
      }
      const token = req.cookies[SESSION_COOKIE];
      const user = await resolveSession(pool, token, cfg.sessionDays);
      if (user) {
        const { renewed, ...rest } = user;
        req.user = rest;
        if (renewed) reply.setCookie(SESSION_COOKIE, token, cookieOptions);
      } else if (!req.routeOptions.config?.public) {
        throw new AppError(401, 'UNAUTHENTICATED', 'sessão inexistente ou expirada');
      }
    });

    const opts = { pool, cfg, cookieOptions };
    await api.register(authRoutes, opts);
    await api.register(instrumentRoutes, opts);
    await api.register(watchlistRoutes, opts);
    await api.register(portfolioRoutes, opts);
    await api.register(alertRoutes, opts);
    await api.register(statusRoutes, opts);
  }, { prefix: '/api/v1' });

  // Em produção a API pode servir também o frontend compilado (aplicação de página única).
  if (cfg.frontendDist && fs.existsSync(path.join(cfg.frontendDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: path.resolve(cfg.frontendDist), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/health/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'rota inexistente' } });
    });
  } else {
    app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'rota inexistente' } }));
  }

  return app;
}
