import { z } from 'zod';
import { audit } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { ErrorBody, Id } from '../schemas.js';
import { imageType } from './photos.js';

const MAX_LOGO_BYTES = 256 * 1024; // o browser envia 128 px em PNG: normalmente alguns kB
export const BATCH = 10; // logotipos em falta pedidos de cada vez

/** Domínio do site («https://www.asml.com/en» → «asml.com»); null se não for um domínio. */
export function domainOf(website) {
  if (!website) return null;
  let host;
  try { host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname; } catch { return null; }
  host = host.toLowerCase().replace(/^www\d?\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** Versão do logotipo interno (ms), para o endereço da imagem; null sem logotipo. */
export const logoVersion = (updatedAt) => (updatedAt ? new Date(updatedAt).getTime() : null);

/** Chave de cliente da Brandfetch: letras, algarismos, «-» e «_» (vai no endereço de cada imagem, como ?c=). */
export const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

const Config = z.object({
  provider: z.literal('brandfetch'),
  clientId: z.string().nullable().describe('Chave de cliente da Brandfetch; null sem configuração (sem logotipos)'),
  enabled: z.boolean().describe('Interruptor global: desligado, nenhuma página mostra logotipos'),
  updatedAt: z.string().nullable(), updatedBy: z.string().nullable(),
});

/**
 * Logotipos dos instrumentos. Ficam na base de dados (instrument_logos) e as páginas mostram só estes. O módulo
 * Administração → Logotipos descarrega no browser do administrador, da Brandfetch Logo API, os que faltam (10 de cada vez)
 * e envia-os para aqui: o servidor nunca contacta a Brandfetch. A chave de cliente (não secreta) e o interruptor global
 * ficam em logo_settings.
 */
export default async function logoRoutes(app, { pool }) {
  async function read() {
    const [[r]] = await pool.query(
      'SELECT s.client_id, s.enabled, s.updated_at, u.name AS updated_by FROM logo_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.id = 1',
    );
    return { provider: 'brandfetch', clientId: r?.client_id ?? null, enabled: r ? Boolean(r.enabled) : true, updatedAt: r?.updated_at?.toISOString() ?? null, updatedBy: r?.updated_by ?? null };
  }
  const adminOnly = (req) => { if (!req.user.isAdmin) throw new AppError(403, 'FORBIDDEN', 'reservado a administradores'); };

  app.get('/logos/config', {
    schema: { tags: ['Logotipos'], summary: 'Configuração dos logotipos (Brandfetch)', response: { 200: Config } },
  }, async () => read());

  app.put('/admin/logos', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['Administração'], summary: 'Guardar a chave de cliente da Brandfetch',
      body: z.object({ clientId: z.string().trim().regex(CLIENT_ID, 'chave inválida: 8 a 64 letras, algarismos, «-» ou «_»') }),
      response: { 200: Config, 400: ErrorBody, 403: ErrorBody },
    },
  }, async (req) => {
    adminOnly(req);
    await pool.query(
      `INSERT INTO logo_settings (id, client_id, updated_by) VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE client_id = VALUES(client_id), updated_by = VALUES(updated_by)`,
      [req.body.clientId, req.user.id],
    );
    await audit(pool, req.user.id, 'admin.logos_set', 'logo_settings', 1, { provider: 'brandfetch' });
    return read();
  });

  app.put('/admin/logos/enabled', {
    schema: {
      tags: ['Administração'], summary: 'Ligar ou desligar os logotipos em todas as páginas',
      body: z.object({ enabled: z.boolean() }), response: { 200: Config, 403: ErrorBody },
    },
  }, async (req) => {
    adminOnly(req);
    await pool.query(
      `INSERT INTO logo_settings (id, enabled, updated_by) VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_by = VALUES(updated_by)`,
      [req.body.enabled, req.user.id],
    );
    await audit(pool, req.user.id, 'admin.logos_enabled', 'logo_settings', 1, { enabled: req.body.enabled });
    return read();
  });

  // ---- Logotipos internos (guardados na base de dados) ----

  app.get('/instruments/:id/logo', {
    schema: { tags: ['Logotipos'], summary: 'Logotipo do instrumento (imagem)', params: z.object({ id: Id }), response: { 404: ErrorBody } },
  }, async (req, reply) => {
    const [[r]] = await pool.query("SELECT image, mime FROM instrument_logos WHERE instrument_id = ? AND status = 'ok'", [req.params.id]);
    if (!r?.image) throw notFound('Logotipo');
    // O endereço leva ?v=<versão>: a imagem pode ficar em cache até mudar.
    return reply.header('content-type', r.mime).header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=31536000, immutable').send(r.image);
  });

  app.get('/admin/logos/summary', {
    schema: {
      tags: ['Administração'], summary: 'Estado dos logotipos dos instrumentos activos',
      response: {
        200: z.object({
          active: z.number(), withLogo: z.number(), missing: z.number().describe('Por descarregar (com site)'),
          notFound: z.number().describe('A Brandfetch não tinha'), noWebsite: z.number().describe('Sem site: não se pode procurar'),
          batch: z.number(),
          recent: z.array(z.object({ instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), status: z.enum(['ok', 'missing']), logoVersion: z.number().nullable(), updatedAt: z.string() })),
        }),
        403: ErrorBody,
      },
    },
  }, async (req) => {
    adminOnly(req);
    const [rows] = await pool.query(
      `SELECT i.id, p.website, l.status FROM instruments i
         LEFT JOIN company_profiles p ON p.instrument_id = i.id LEFT JOIN instrument_logos l ON l.instrument_id = i.id
        WHERE i.status = 'active'`,
    );
    const c = { active: rows.length, withLogo: 0, missing: 0, notFound: 0, noWebsite: 0 };
    for (const r of rows) {
      if (r.status === 'ok') c.withLogo += 1;
      else if (r.status === 'missing') c.notFound += 1;
      else if (!domainOf(r.website)) c.noWebsite += 1;
      else c.missing += 1;
    }
    const [recent] = await pool.query(
      `SELECT l.instrument_id, i.symbol, i.name, l.status, l.updated_at FROM instrument_logos l JOIN instruments i ON i.id = l.instrument_id
        ORDER BY l.updated_at DESC LIMIT 30`,
    );
    return {
      ...c, batch: BATCH,
      recent: recent.map((r) => ({
        instrumentId: Number(r.instrument_id), symbol: r.symbol, name: r.name, status: r.status,
        logoVersion: r.status === 'ok' ? logoVersion(r.updated_at) : null, updatedAt: r.updated_at.toISOString(),
      })),
    };
  });

  app.get('/admin/logos/missing', {
    schema: {
      tags: ['Administração'], summary: 'Próximos instrumentos activos sem logotipo (com site), no máximo 10',
      querystring: z.object({ retry: z.coerce.boolean().default(false).describe('Incluir os que a Brandfetch não tinha') }),
      response: { 200: z.object({ items: z.array(z.object({ instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), domain: z.string() })) }), 403: ErrorBody },
    },
  }, async (req) => {
    adminOnly(req);
    const [rows] = await pool.query(
      `SELECT i.id, i.symbol, i.name, p.website FROM instruments i
         JOIN company_profiles p ON p.instrument_id = i.id LEFT JOIN instrument_logos l ON l.instrument_id = i.id
        WHERE i.status = 'active' AND p.website IS NOT NULL AND (l.status IS NULL ${req.query.retry ? "OR l.status = 'missing'" : ''})
        ORDER BY i.symbol`,
    );
    const items = [];
    for (const r of rows) {
      const domain = domainOf(r.website);
      if (domain) items.push({ instrumentId: Number(r.id), symbol: r.symbol, name: r.name, domain });
      if (items.length >= BATCH) break;
    }
    return { items };
  });

  app.put('/admin/instruments/:id/logo', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['Administração'], summary: 'Guardar o logotipo de um instrumento (multipart, campo "file"; PNG, JPEG ou WebP)',
      consumes: ['multipart/form-data'], params: z.object({ id: Id }),
      response: { 200: z.object({ logoVersion: z.number() }), 400: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    adminOnly(req);
    if (!req.isMultipart()) throw new AppError(400, 'INVALID_FILE', 'envie o logotipo em multipart/form-data');
    const file = await req.file();
    if (!file) throw new AppError(400, 'INVALID_FILE', 'nenhum ficheiro recebido');
    const buffer = await file.toBuffer();
    if (buffer.length > MAX_LOGO_BYTES) throw new AppError(400, 'INVALID_FILE', 'o logotipo é demasiado grande (máximo 256 kB)');
    const mime = imageType(buffer);
    if (!mime) throw new AppError(400, 'INVALID_FILE', 'o logotipo deve ser PNG, JPEG ou WebP');
    const [[inst]] = await pool.query(
      'SELECT i.id, p.website FROM instruments i LEFT JOIN company_profiles p ON p.instrument_id = i.id WHERE i.id = ?', [req.params.id],
    );
    if (!inst) throw notFound('Instrumento');
    await pool.query(
      `INSERT INTO instrument_logos (instrument_id, status, image, mime, domain, source, updated_by) VALUES (?, 'ok', ?, ?, ?, 'brandfetch', ?)
       ON DUPLICATE KEY UPDATE status = 'ok', image = VALUES(image), mime = VALUES(mime), domain = VALUES(domain), source = VALUES(source),
                               updated_by = VALUES(updated_by), updated_at = NOW(3)`,
      [inst.id, buffer, mime, domainOf(inst.website), req.user.id],
    );
    await audit(pool, req.user.id, 'admin.logo_set', 'instrument', inst.id, { bytes: buffer.length });
    const [[l]] = await pool.query('SELECT updated_at FROM instrument_logos WHERE instrument_id = ?', [inst.id]);
    return { logoVersion: logoVersion(l.updated_at) };
  });

  app.post('/admin/instruments/:id/logo/not-found', {
    schema: {
      tags: ['Administração'], summary: 'Marcar que a Brandfetch não tem logotipo deste instrumento (não se volta a pedir)',
      params: z.object({ id: Id }), response: { 204: z.null(), 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req, reply) => {
    adminOnly(req);
    const [[inst]] = await pool.query('SELECT id FROM instruments WHERE id = ?', [req.params.id]);
    if (!inst) throw notFound('Instrumento');
    // Não apaga um logotipo que já exista.
    await pool.query(
      `INSERT INTO instrument_logos (instrument_id, status, updated_by) VALUES (?, 'missing', ?)
       ON DUPLICATE KEY UPDATE updated_by = IF(status = 'ok', updated_by, VALUES(updated_by))`,
      [inst.id, req.user.id],
    );
    return reply.code(204).send(null);
  });

  app.delete('/admin/instruments/:id/logo', {
    schema: { tags: ['Administração'], summary: 'Apagar o logotipo de um instrumento (volta a ficar em falta)', params: z.object({ id: Id }), response: { 204: z.null(), 403: ErrorBody } },
  }, async (req, reply) => {
    adminOnly(req);
    await pool.query('DELETE FROM instrument_logos WHERE instrument_id = ?', [req.params.id]);
    await audit(pool, req.user.id, 'admin.logo_remove', 'instrument', req.params.id);
    return reply.code(204).send(null);
  });

  app.delete('/admin/logos', {
    schema: { tags: ['Administração'], summary: 'Apagar a chave da Brandfetch (deixa de haver logotipos)', response: { 200: Config, 403: ErrorBody } },
  }, async (req) => {
    adminOnly(req);
    await pool.query('UPDATE logo_settings SET client_id = NULL, updated_by = ? WHERE id = 1', [req.user.id]);
    await audit(pool, req.user.id, 'admin.logos_remove', 'logo_settings', 1);
    return read();
  });
}
