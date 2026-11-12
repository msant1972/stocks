import { z } from 'zod';
import { audit } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { ErrorBody, Id } from '../schemas.js';

const MAX_BYTES = 512 * 1024; // o browser reduz a fotografia (256 px, JPEG): normalmente fica abaixo de 30 kB

/** Tipo da imagem pelos primeiros bytes (não confia no nome nem no tipo declarado); null se não for JPEG, PNG ou WebP. */
export function imageType(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const Version = z.object({ photoVersion: z.number().nullable() });

/** Fotografia dos utilizadores: ver (qualquer utilizador autenticado), mudar e remover (a própria; os administradores, a de qualquer). */
export default async function photoRoutes(app, { pool }) {
  async function save(req, id) {
    if (!req.isMultipart()) throw new AppError(400, 'INVALID_FILE', 'envie a fotografia em multipart/form-data');
    const file = await req.file();
    if (!file) throw new AppError(400, 'INVALID_FILE', 'nenhum ficheiro recebido');
    const buffer = await file.toBuffer();
    if (buffer.length > MAX_BYTES) throw new AppError(400, 'INVALID_FILE', 'a fotografia é demasiado grande (máximo 512 kB)');
    const type = imageType(buffer);
    if (!type) throw new AppError(400, 'INVALID_FILE', 'a fotografia deve ser JPEG, PNG ou WebP');
    const [res] = await pool.query('UPDATE users SET photo = ?, photo_type = ?, photo_updated_at = NOW(3) WHERE id = ?', [buffer, type, id]);
    if (!res.affectedRows) throw notFound('Utilizador');
    await audit(pool, req.user.id, 'user.photo_set', 'user', id, { bytes: buffer.length });
    return version(id);
  }
  async function remove(req, id) {
    const [res] = await pool.query('UPDATE users SET photo = NULL, photo_type = NULL, photo_updated_at = NULL WHERE id = ?', [id]);
    if (!res.affectedRows) throw notFound('Utilizador');
    await audit(pool, req.user.id, 'user.photo_remove', 'user', id);
    return { photoVersion: null };
  }
  async function version(id) {
    const [[u]] = await pool.query('SELECT photo_updated_at FROM users WHERE id = ?', [id]);
    return { photoVersion: u?.photo_updated_at ? new Date(u.photo_updated_at).getTime() : null };
  }
  const adminOnly = (req) => { if (!req.user.isAdmin) throw new AppError(403, 'FORBIDDEN', 'reservado a administradores'); };
  const rate = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  app.get('/users/:id/photo', {
    schema: { tags: ['Utilizadores'], summary: 'Fotografia de um utilizador (imagem)', params: z.object({ id: Id }), response: { 404: ErrorBody } },
  }, async (req, reply) => {
    const [[u]] = await pool.query('SELECT photo, photo_type FROM users WHERE id = ? AND disabled_at IS NULL', [req.params.id]);
    if (!u?.photo) throw notFound('Fotografia');
    // O endereço leva ?v=<versão>: a imagem pode ficar em cache até mudar.
    return reply.header('content-type', u.photo_type).header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=31536000, immutable').send(u.photo);
  });

  app.put('/me/photo', {
    config: rate,
    schema: { tags: ['Utilizadores'], summary: 'Mudar a minha fotografia (multipart, campo "file")', consumes: ['multipart/form-data'], response: { 200: Version, 400: ErrorBody } },
  }, async (req) => save(req, req.user.id));

  app.delete('/me/photo', {
    schema: { tags: ['Utilizadores'], summary: 'Remover a minha fotografia', response: { 200: Version } },
  }, async (req) => remove(req, req.user.id));

  app.put('/admin/users/:id/photo', {
    config: rate,
    schema: {
      tags: ['Administração'], summary: 'Mudar a fotografia de um utilizador (multipart, campo "file")', consumes: ['multipart/form-data'],
      params: z.object({ id: Id }), response: { 200: Version, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => { adminOnly(req); return save(req, req.params.id); });

  app.delete('/admin/users/:id/photo', {
    schema: {
      tags: ['Administração'], summary: 'Remover a fotografia de um utilizador',
      params: z.object({ id: Id }), response: { 200: Version, 403: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => { adminOnly(req); return remove(req, req.params.id); });
}
