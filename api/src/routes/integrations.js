import { z } from 'zod';
import { audit, withTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { encryptSecret } from '../secrets.js';
import { ErrorBody } from '../schemas.js';

const PROVIDER = 'saxo';
const Status = z.object({
  configured: z.boolean(),
  updatedAt: z.string().nullable(),
  environment: z.enum(['sim', 'live']).nullable().describe('Ambiente do token; por agora só a simulação (sim)'),
  expiresAt: z.string().nullable().describe('O token do portal dura 24 h'),
  expired: z.boolean().describe('Expirou ou a SAXO recusou-o: é preciso guardar um novo'),
  canEncrypt: z.boolean().describe('false: a chave de cifra do servidor não está configurada e não é possível guardar o token'),
});

/**
 * Token de acesso do utilizador à SAXO Bank. Fica cifrado na BD, por utilizador, e nunca é devolvido: a API só
 * diz se existe e quando foi guardado. É usado para enviar ordens para a conta de simulação (SIM) da SAXO; o token do portal dura 24 h.
 */
export default async function integrationRoutes(app, { pool, cfg }) {
  async function status(userId) {
    const [[r]] = await pool.query(
      'SELECT updated_at, environment, expires_at, rejected_at FROM user_integration_tokens WHERE user_id = ? AND provider = ?', [userId, PROVIDER],
    );
    return {
      configured: Boolean(r), updatedAt: r?.updated_at.toISOString() ?? null, canEncrypt: Boolean(cfg.secretKey),
      environment: r?.environment ?? null, expiresAt: r?.expires_at?.toISOString() ?? null,
      expired: Boolean(r && (r.rejected_at || (r.expires_at && r.expires_at.getTime() < Date.now()))),
    };
  }

  app.get('/me/integrations/saxo', {
    schema: { tags: ['Conta'], summary: 'Estado do token da SAXO Bank (nunca o devolve)', response: { 200: Status } },
  }, async (req) => status(req.user.id));

  app.put('/me/integrations/saxo', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Conta'], summary: 'Guardar o token da SAXO Bank (cifrado; substitui o anterior)',
      body: z.object({
        token: z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/, 'o token não pode ter espaços nem caracteres especiais'),
      }),
      response: { 200: Status, 400: ErrorBody, 409: ErrorBody },
    },
  }, async (req) => {
    if (!cfg.secretKey) {
      throw new AppError(409, 'NO_SECRET_KEY', 'a chave de cifra do servidor não está configurada; não é possível guardar o token');
    }
    await withTransaction(pool, async (conn) => {
      await conn.query(
        `INSERT INTO user_integration_tokens (user_id, provider, token_enc, environment, expires_at, rejected_at)
         VALUES (?, ?, ?, 'sim', DATE_ADD(NOW(3), INTERVAL 24 HOUR), NULL)
         ON DUPLICATE KEY UPDATE token_enc = VALUES(token_enc), environment = 'sim', expires_at = VALUES(expires_at), rejected_at = NULL`,
        [req.user.id, PROVIDER, encryptSecret(cfg.secretKey, req.body.token)],
      );
      await audit(conn, req.user.id, 'integration.token_set', 'integration', null, { provider: PROVIDER });
    });
    return status(req.user.id);
  });

  app.delete('/me/integrations/saxo', {
    schema: { tags: ['Conta'], summary: 'Remover o token da SAXO Bank', response: { 204: z.null() } },
  }, async (req, reply) => {
    await withTransaction(pool, async (conn) => {
      const [res] = await conn.query('DELETE FROM user_integration_tokens WHERE user_id = ? AND provider = ?', [req.user.id, PROVIDER]);
      if (res.affectedRows) await audit(conn, req.user.id, 'integration.token_remove', 'integration', null, { provider: PROVIDER });
    });
    return reply.code(204).send(null);
  });
}
