import { z } from 'zod';
import { audit, withTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { authorizeUrl, redirectUri, signState, tokenRequest, verifyState } from '../saxo/oauth.js';
import { loadApp, saveOauthTokens } from '../saxo/tokens.js';
import { encryptSecret } from '../secrets.js';
import { ErrorBody } from '../schemas.js';

const PROVIDER = 'saxo';
const Status = z.object({
  configured: z.boolean(),
  updatedAt: z.string().nullable(),
  environment: z.enum(['sim', 'live']).nullable().describe('Ambiente da ligação; por agora só a simulação (sim)'),
  kind: z.enum(['oauth']).nullable().describe('oauth: ligada pela aplicação SAXO (API Key), com renovação automática'),
  expired: z.boolean().describe('Expirou ou a SAXO recusou-o: é preciso ligar de novo'),
  canEncrypt: z.boolean().describe('false: a chave de cifra do servidor não está configurada e não é possível guardar segredos'),
  app: z.object({ appKey: z.string(), hasSecret: z.boolean() }).nullable().describe('Aplicação SAXO guardada (o segredo nunca é devolvido)'),
  redirectUri: z.string().nullable().describe('URL de retorno que tem de estar registado na aplicação SAXO'),
  canConnect: z.boolean(),
});

const AppKey = z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/, 'a chave da aplicação deve ter 8 a 64 letras, números, - ou _');
const AppSecret = z.string().trim().min(8).max(256).regex(/^[\x21-\x7e]+$/, 'o segredo não pode ter espaços nem caracteres especiais');

/**
 * Ligação do utilizador à SAXO Bank. Segredos (segredo da aplicação, access e refresh tokens) ficam cifrados na BD e nunca são
 * devolvidos: a API só diz o que existe. A ligação é feita com a aplicação SAXO do utilizador (API Key + segredo) e o fluxo
 * OAuth «Authorization Code», com renovação automática. Só a conta de simulação (SIM).
 */
export default async function integrationRoutes(app, { pool, cfg }) {
  async function status(userId) {
    const [[r]] = await pool.query(
      `SELECT updated_at, environment, auth_kind, expires_at, refresh_expires_at, rejected_at
         FROM user_integration_tokens WHERE user_id = ? AND provider = ?`, [userId, PROVIDER],
    );
    const [[a]] = await pool.query('SELECT app_key FROM user_saxo_apps WHERE user_id = ?', [userId]);
    const now = Date.now();
    const expired = Boolean(r && (r.rejected_at || (r.refresh_expires_at && r.refresh_expires_at.getTime() < now)));
    return {
      configured: Boolean(r), updatedAt: r?.updated_at.toISOString() ?? null, canEncrypt: Boolean(cfg.secretKey),
      environment: r?.environment ?? null, kind: r?.auth_kind ?? null,
      expired,
      app: a ? { appKey: a.app_key, hasSecret: true } : null,
      redirectUri: redirectUri(cfg), canConnect: Boolean(cfg.secretKey && redirectUri(cfg)),
    };
  }
  const needKey = () => {
    if (!cfg.secretKey) throw new AppError(409, 'NO_SECRET_KEY', 'a chave de cifra do servidor não está configurada; não é possível guardar segredos');
  };

  app.get('/me/integrations/saxo', {
    schema: { tags: ['Conta'], summary: 'Estado da ligação à SAXO Bank (nunca devolve segredos)', response: { 200: Status } },
  }, async (req) => status(req.user.id));

  // --- Aplicação SAXO (chave e segredo) ---
  app.put('/me/integrations/saxo/app', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Conta'], summary: 'Guardar a aplicação SAXO (chave e segredo; o segredo fica cifrado)',
      description: 'Sem `appSecret`, mantém o segredo já guardado (só se a chave for a mesma).',
      body: z.object({ appKey: AppKey, appSecret: AppSecret.optional() }),
      response: { 200: Status, 400: ErrorBody, 409: ErrorBody },
    },
  }, async (req) => {
    needKey();
    const { appKey, appSecret } = req.body;
    await withTransaction(pool, async (conn) => {
      const [[cur]] = await conn.query('SELECT app_key FROM user_saxo_apps WHERE user_id = ? FOR UPDATE', [req.user.id]);
      if (!appSecret && (!cur || cur.app_key !== appKey)) throw new AppError(400, 'SECRET_REQUIRED', 'indique o segredo da aplicação');
      if (appSecret) {
        await conn.query(
          'INSERT INTO user_saxo_apps (user_id, app_key, app_secret_enc) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE app_key = VALUES(app_key), app_secret_enc = VALUES(app_secret_enc)',
          [req.user.id, appKey, encryptSecret(cfg.secretKey, appSecret)],
        );
      }
      // Outra aplicação: a ligação OAuth anterior já não serve.
      if (cur && cur.app_key !== appKey) await conn.query("DELETE FROM user_integration_tokens WHERE user_id = ? AND provider = ? AND auth_kind = 'oauth'", [req.user.id, PROVIDER]);
      await audit(conn, req.user.id, 'integration.app_set', 'integration', null, { provider: PROVIDER });
    });
    return status(req.user.id);
  });

  app.delete('/me/integrations/saxo/app', {
    schema: { tags: ['Conta'], summary: 'Remover a aplicação SAXO (e a ligação OAuth)', response: { 204: z.null() } },
  }, async (req, reply) => {
    await withTransaction(pool, async (conn) => {
      await conn.query("DELETE FROM user_integration_tokens WHERE user_id = ? AND provider = ? AND auth_kind = 'oauth'", [req.user.id, PROVIDER]);
      const [res] = await conn.query('DELETE FROM user_saxo_apps WHERE user_id = ?', [req.user.id]);
      if (res.affectedRows) await audit(conn, req.user.id, 'integration.app_remove', 'integration', null, { provider: PROVIDER });
    });
    return reply.code(204).send(null);
  });

  // --- OAuth: Authorization Code Grant ---
  app.post('/me/integrations/saxo/connect', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Conta'], summary: 'Iniciar a ligação à SAXO: devolve o endereço de autorização para onde enviar o browser',
      response: { 200: z.object({ url: z.string() }), 409: ErrorBody },
    },
  }, async (req) => {
    needKey();
    if (!redirectUri(cfg)) throw new AppError(409, 'NO_PUBLIC_ORIGIN', 'a origem pública da aplicação (STOCKS_PUBLIC_ORIGIN) não está configurada');
    const a = await loadApp(pool, cfg, req.user.id);
    if (!a) throw new AppError(409, 'NO_SAXO_APP', 'guarde primeiro a chave e o segredo da aplicação SAXO');
    await audit(pool, req.user.id, 'integration.connect_start', 'integration', null, { provider: PROVIDER });
    return { url: authorizeUrl(cfg, a.key, signState(cfg, req.user.id)) };
  });

  // A SAXO devolve o browser aqui. O cookie de sessão é SameSite=Strict e não segue uma navegação vinda de outro site,
  // por isso a rota é pública e o utilizador vem do `state` assinado (emitido só a quem tinha sessão, válido 10 min).
  app.get('/integrations/saxo/callback', {
    config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { tags: ['Conta'], summary: 'Retorno da autorização da SAXO (redirecciona para as Definições)', hide: true },
  }, async (req, reply) => {
    const back = (result, why) => reply.redirect(`/definicoes?saxo=${result}${why ? `&motivo=${encodeURIComponent(why)}` : ''}`);
    const { code, state, error } = req.query ?? {};
    const userId = cfg.secretKey ? verifyState(cfg, state) : null;
    if (!userId) return back('erro', 'pedido inválido ou expirado; volte a ligar');
    if (error || !code) return back('erro', error === 'access_denied' ? 'a autorização foi recusada' : 'a SAXO não devolveu o código de autorização');
    try {
      const a = await loadApp(pool, cfg, userId);
      if (!a) return back('erro', 'a aplicação SAXO já não está guardada');
      const tok = await tokenRequest(cfg, a, { grant_type: 'authorization_code', code: String(code), redirect_uri: redirectUri(cfg) });
      await withTransaction(pool, async (conn) => {
        await saveOauthTokens(conn, cfg, userId, tok);
        await audit(conn, userId, 'integration.connected', 'integration', null, { provider: PROVIDER, kind: 'oauth' });
      });
      return back('ok');
    } catch (err) {
      req.log.warn({ code: err.code }, 'saxo: ligação OAuth falhou');
      return back('erro', err instanceof AppError ? err.message : 'não foi possível concluir a ligação');
    }
  });

  app.delete('/me/integrations/saxo', {
    schema: { tags: ['Conta'], summary: 'Desligar da SAXO Bank (remove os tokens; a aplicação SAXO fica guardada)', response: { 204: z.null() } },
  }, async (req, reply) => {
    await withTransaction(pool, async (conn) => {
      const [res] = await conn.query('DELETE FROM user_integration_tokens WHERE user_id = ? AND provider = ?', [req.user.id, PROVIDER]);
      if (res.affectedRows) await audit(conn, req.user.id, 'integration.token_remove', 'integration', null, { provider: PROVIDER });
    });
    return reply.code(204).send(null);
  });
}
