import { z } from 'zod';
import { audit } from '../db.js';
import { AppError } from '../errors.js';
import { ErrorBody } from '../schemas.js';

/** Chave de cliente da Brandfetch: letras, algarismos, «-» e «_» (vai no endereço de cada imagem, como ?c=). */
export const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

const Config = z.object({
  provider: z.literal('brandfetch'),
  clientId: z.string().nullable().describe('Chave de cliente da Brandfetch; null sem configuração (sem logotipos)'),
  updatedAt: z.string().nullable(), updatedBy: z.string().nullable(),
});

/**
 * Logotipos dos instrumentos (Brandfetch Logo API). A chave de cliente não é secreta: vai no endereço de cada imagem, que o
 * browser pede directamente ao CDN da Brandfetch (as regras da Brandfetch não deixam guardar as imagens). Todos os
 * utilizadores a lêem; só os administradores a mudam.
 */
export default async function logoRoutes(app, { pool }) {
  async function read() {
    const [[r]] = await pool.query(
      'SELECT s.client_id, s.updated_at, u.name AS updated_by FROM logo_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.id = 1',
    );
    return { provider: 'brandfetch', clientId: r?.client_id ?? null, updatedAt: r?.updated_at?.toISOString() ?? null, updatedBy: r?.updated_by ?? null };
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

  app.delete('/admin/logos', {
    schema: { tags: ['Administração'], summary: 'Apagar a chave da Brandfetch (deixa de haver logotipos)', response: { 200: Config, 403: ErrorBody } },
  }, async (req) => {
    adminOnly(req);
    await pool.query('UPDATE logo_settings SET client_id = NULL, updated_by = ? WHERE id = 1', [req.user.id]);
    await audit(pool, req.user.id, 'admin.logos_remove', 'logo_settings', 1);
    return read();
  });
}
