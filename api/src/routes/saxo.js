import { z } from 'zod';
import { createThrottle } from '../saxo/client.js';
import * as saxo from '../saxo/service.js';
import { catalogStatus, startCatalogSync } from '../saxo/catalog-runner.js';
import { accountHistory } from '../saxo/history.js';
import { AppError } from '../errors.js';
import { AVAILABLE_STRATEGIES } from '../../../shared/strategies/index.js';
import { automationOrders, automationStatus, setAutomationEnabled, setAutomationStrategy } from '../saxo/automation.js';
import { sendPendingEmails } from '../saxo/watcher.js';
import { ErrorBody, Id, IsoDate } from '../schemas.js';

const Side = z.enum(['buy', 'sell']);
const Price = z.string().regex(/^\d+(\.\d{1,6})?$/);
const Quantity = z.number().int().min(1).max(10_000_000);
const OrderParams = z.object({
  instrumentId: Id,
  side: Side,
  quantity: Quantity,
  orderType: z.enum(['market', 'limit']),
  limitPrice: Price.optional().describe('Obrigatório nas ordens limitadas'),
  stop: z.object({
    type: z.enum(['stop', 'trailing']).describe('stop: fixo (price); trailing: móvel (distance abaixo do mercado)'),
    price: Price.optional(),
    distance: Price.optional(),
  }).optional().describe('Só nas compras: ordem de venda de protecção, activa quando a compra é executada'),
});
const Status = z.enum(['sending', 'working', 'filled', 'expired', 'cancelled', 'rejected', 'ended', 'unknown']);
const Order = z.object({
  id: z.number(), parentId: z.number().nullable(), instrumentId: z.number(), symbol: z.string().nullable(), name: z.string().nullable(),
  environment: z.enum(['sim', 'live']), saxoOrderId: z.string().nullable(), side: Side, quantity: z.number(),
  orderType: z.enum(['market', 'limit', 'stop', 'trailing_stop']),
  limitPrice: z.string().nullable(), stopPrice: z.string().nullable(), trailDistance: z.string().nullable(), appPrice: z.string().nullable(),
  filledQuantity: z.number().nullable(), fillPrice: z.string().nullable(), finishedAt: z.string().nullable(),
  status: Status, message: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
});
const Errors = { 403: ErrorBody, 404: ErrorBody, 409: ErrorBody, 422: ErrorBody, 429: ErrorBody, 502: ErrorBody };

/**
 * Ordens para a conta de SIMULAÇÃO da SAXO Bank (a conta real fica recusada até STOCKS_SAXO_ALLOW_LIVE=true).
 * Duas fases, sempre com confirmação: pré-validar (precheck da SAXO) e enviar com o código devolvido.
 */
export default async function saxoRoutes(app, { pool, cfg }) {
  const wait = createThrottle(() => cfg.saxo.orderSpacingMs);
  const session = (req) => saxo.openSession(pool, cfg, req.user.id);

  app.get('/saxo/connection', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Testar a ligação à SAXO Bank (conta e saldo)',
      response: {
        200: z.object({
          environment: z.enum(['sim', 'live']), accountId: z.string(), currency: z.string(), isTrial: z.boolean(),
          cashBalance: z.number().nullable(), totalValue: z.number().nullable(),
        }), ...Errors,
      },
    },
  }, async (req) => saxo.testConnection(await session(req)));

  app.post('/saxo/orders/preview', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Pré-validar uma ordem (não envia nada)',
      description: 'Resolve o instrumento na SAXO, aplica as verificações da aplicação (negociável, tipo de ordem, passo de preço, '
        + 'quantidade mínima) e devolve o resumo e um código de confirmação (5 minutos) ligado a estes parâmetros. O precheck da '
        + 'SAXO (`prechecked: true`) só corre nas ordens a mercado, com stop associado ou na conta real; as limitadas simples são '
        + 'validadas pela SAXO no envio. Se houver várias correspondências, 409 SAXO_AMBIGUOUS com os candidatos.',
      body: OrderParams,
      response: { 200: z.object({}).passthrough(), 400: ErrorBody, ...Errors },
    },
  }, async (req) => saxo.previewOrder(pool, cfg, await session(req), req.body, { wait }));

  app.post('/saxo/instruments/:instrumentId/match', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Escolher o instrumento da SAXO que corresponde ao da aplicação',
      params: z.object({ instrumentId: Id }), body: z.object({ uic: z.number().int().positive() }),
      response: { 200: z.object({ uic: z.number(), symbol: z.string() }), 400: ErrorBody, ...Errors },
    },
  }, async (req) => {
    const r = await saxo.chooseInstrument(pool, await session(req), req.params.instrumentId, req.body.uic);
    return { uic: Number(r.uic), symbol: r.saxo_symbol };
  });

  // ---------- Automação: sinais enviados automaticamente à conta de simulação ----------

  const AutomationStatus = z.object({
    enabled: z.boolean(),
    strategies: z.array(z.object({ id: z.string(), name: z.string(), summary: z.string().nullable(), budget: z.number().nullable(), enabled: z.boolean() })),
    lastRun: z.object({
      date: z.string(), status: z.enum(['running', 'done', 'failed']), counts: z.record(z.string(), z.number()), detail: z.string().nullable(), startedAt: z.string(), finishedAt: z.string().nullable(),
    }).nullable(),
  });

  app.get('/saxo/automation', {
    schema: {
      tags: ['SAXO'], summary: 'Estado da automação (interruptor geral, estratégias e última execução)',
      description: 'A automação corre de hora a hora nos dias úteis, 10 minutos depois de cada recolha horária (08:33 a 17:33 de Lisboa), com os sinais da sessão em curso e da última sessão, e só na conta de simulação. Compras limitadas ao último '
        + 'preço + 1 %, vendas a mercado do que a automação comprou para essa estratégia; ordens do dia. Desligada por omissão.',
      response: { 200: AutomationStatus },
    },
  }, async (req) => automationStatus(pool, req.user.id));

  app.put('/saxo/automation', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Ligar ou desligar a automação (interruptor geral)',
      body: z.object({ enabled: z.boolean() }), response: { 200: AutomationStatus, 400: ErrorBody },
    },
  }, async (req) => {
    await setAutomationEnabled(pool, req.user.id, req.body.enabled);
    return automationStatus(pool, req.user.id);
  });

  app.put('/saxo/automation/strategies/:strategyId', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Ligar ou desligar a automação de uma estratégia',
      params: z.object({ strategyId: z.enum(AVAILABLE_STRATEGIES.map((s) => s.id)) }),
      body: z.object({ enabled: z.boolean() }), response: { 200: AutomationStatus, 400: ErrorBody },
    },
  }, async (req) => {
    await setAutomationStrategy(pool, req.user.id, req.params.strategyId, req.body.enabled);
    return automationStatus(pool, req.user.id);
  });

  app.get('/saxo/automation/orders', {
    schema: {
      tags: ['SAXO'], summary: 'Sinais tratados pela automação, com o estado real da ordem na SAXO',
      description: 'outcome: sent (ordem criada; o estado está em order.status), skipped (sem ordem, com o motivo em message) ou failed (não chegou à SAXO).',
      querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }),
      response: {
        200: z.object({
          items: z.array(z.object({
            id: z.number(), strategy: z.string(), strategyName: z.string(), signalDate: z.string(), signalSide: z.enum(['buy', 'add', 'sell']), reason: z.string().nullable(),
            outcome: z.enum(['sent', 'skipped', 'failed']), message: z.string().nullable(), createdAt: z.string(),
            instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(),
            order: z.object({
              id: z.number(), saxoOrderId: z.string().nullable(), side: Side, quantity: z.number(), orderType: z.enum(['market', 'limit', 'stop', 'trailing_stop']),
              limitPrice: z.string().nullable(), status: Status, filledQuantity: z.number().nullable(), fillPrice: z.string().nullable(),
            }).nullable(),
          })),
        }),
      },
    },
  }, async (req) => ({ items: await automationOrders(pool, req.user.id, { limit: req.query.limit }) }));

  // ---------- Correspondência do catálogo com a SAXO (administradores) ----------

  const adminOnly = (req) => { if (!req.user.isAdmin) throw new AppError(403, 'FORBIDDEN', 'reservado a administradores'); };
  const envOf = async (userId) => {
    const [[t]] = await pool.query("SELECT environment FROM user_integration_tokens WHERE user_id = ? AND provider = 'saxo'", [userId]);
    return t?.environment ?? 'sim';
  };
  const Candidate = z.object({
    uic: z.number(), symbol: z.string(), description: z.string().nullable(), exchangeId: z.string().nullable(),
    mic: z.string().nullable().optional(), currency: z.string().nullable(), nameScore: z.number().optional(),
  }).passthrough();
  const MatchStatus = z.enum(['linked', 'unchecked', 'ambiguous', 'other_market', 'not_found', 'not_tradable', 'error']);

  app.get('/saxo/catalog', {
    schema: {
      tags: ['SAXO'], summary: 'Correspondência de cada instrumento do catálogo com a SAXO Bank (administradores)',
      description: 'Estado por instrumento activo: linked (ligado), unchecked (ainda não procurado), ambiguous (vários candidatos '
        + 'na bolsa certa), other_market (só noutra bolsa), not_found, not_tradable, error. Inclui os candidatos para escolha manual '
        + 'e a última ligação do catálogo.',
      response: {
        200: z.object({
          environment: z.enum(['sim', 'live']),
          summary: z.record(z.string(), z.number()),
          items: z.array(z.object({
            instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), exchange: z.string().nullable(), isin: z.string().nullable(),
            status: MatchStatus,
            saxo: z.object({
              uic: z.number(), symbol: z.string(), description: z.string().nullable(), exchangeId: z.string().nullable(),
              source: z.enum(['auto', 'manual']), nameScore: z.number().nullable(), checkedAt: z.string().nullable(),
            }).nullable(),
            message: z.string().nullable(), candidates: z.array(Candidate), issueAt: z.string().nullable(),
          })),
          lastRun: z.object({
            id: z.number(), status: z.enum(['running', 'done', 'failed']), recheck: z.boolean(), trigger: z.enum(['manual', 'weekly']),
            total: z.number(), processed: z.number(), counts: z.record(z.string(), z.number()), detail: z.string().nullable(),
            userName: z.string().nullable(), startedAt: z.string(), finishedAt: z.string().nullable(),
          }).nullable(),
        }),
        403: ErrorBody,
      },
    },
  }, async (req) => {
    adminOnly(req);
    return catalogStatus(pool, await envOf(req.user.id));
  });

  app.post('/saxo/catalog/sync', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Ligar o catálogo inteiro à SAXO Bank (em segundo plano; administradores)',
      description: 'Procura na SAXO os instrumentos activos ainda sem correspondência (ISIN, raiz do símbolo e nome, na bolsa certa) e, '
        + 'com recheck, revalida os já ligados (negociável, mesma moeda). Usa o token SAXO de quem pede. Uma de cada vez '
        + '(409 SAXO_SYNC_RUNNING). O progresso vê-se em GET /saxo/catalog.',
      body: z.object({ recheck: z.boolean().default(false) }).default({}),
      response: { 202: z.object({ id: z.number() }), ...Errors },
    },
  }, async (req, reply) => {
    adminOnly(req);
    const { id } = await startCatalogSync(pool, cfg, req.user.id, { recheck: req.body.recheck, log: req.log });
    return reply.code(202).send({ id });
  });

  app.delete('/saxo/instruments/:instrumentId/match', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Desligar um instrumento da SAXO Bank (administradores)',
      description: 'Apaga a correspondência e o problema registado; o instrumento volta a «por procurar».',
      params: z.object({ instrumentId: Id }),
      response: { 204: z.null(), 403: ErrorBody },
    },
  }, async (req, reply) => {
    adminOnly(req);
    const env = await envOf(req.user.id);
    await pool.query('DELETE FROM saxo_instruments WHERE instrument_id = ? AND environment = ?', [req.params.instrumentId, env]);
    await pool.query('DELETE FROM saxo_match_issues WHERE instrument_id = ? AND environment = ?', [req.params.instrumentId, env]);
    return reply.code(204).send(null);
  });

  app.post('/saxo/orders', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Enviar uma ordem para a SAXO Bank',
      description: 'Envio directo: a API aplica as verificações (instrumento, negociável, tipo de ordem, passo de preço, stop, quantidade) '
        + 'e a SAXO valida a ordem ao recebê-la; uma recusa fica com o estado rejected e a mensagem da SAXO. Opcionalmente, '
        + '`confirmation` de POST /saxo/orders/preview liga o envio aos parâmetros pré-validados; na conta real é obrigatório '
        + '(409 SAXO_CONFIRMATION_REQUIRED). Várias correspondências: 409 SAXO_AMBIGUOUS com os candidatos. Repetir a '
        + 'idempotencyKey devolve a ordem original.',
      body: OrderParams.extend({
        confirmation: z.string().min(10).max(200).optional(),
        idempotencyKey: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
      }),
      response: { 200: z.object({ order: Order, replayed: z.boolean() }), 201: z.object({ order: Order, replayed: z.boolean() }), 400: ErrorBody, ...Errors },
    },
  }, async (req, reply) => {
    const r = await saxo.placeOrder(pool, cfg, await session(req), req.body, { wait });
    return reply.code(r.replayed ? 200 : 201).send(r);
  });

  app.get('/saxo/orders', {
    schema: {
      tags: ['SAXO'], summary: 'Ordens enviadas à SAXO pela aplicação (com o estado actualizado)',
      querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }),
      response: { 200: z.object({ items: z.array(Order), total: z.number(), refreshError: z.string().nullable() }) },
    },
  }, async (req) => {
    let s;
    try { s = await session(req); } catch { s = { userId: req.user.id, client: null }; } // sem token válido, mostra o que está guardado
    const r = await saxo.listOrders(pool, s, req.query);
    if (r.ended) sendPendingEmails(cfg, req.log); // não espera: o aviso por email segue em segundo plano
    return r;
  });

  app.get('/saxo/portfolio', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Carteira da conta SAXO: saldo, valor total, custo e posições abertas',
      description: 'O SIM não tem preços de mercado: o valor e o resultado das posições usam o último preço da aplicação.',
      response: {
        200: z.object({
          environment: z.enum(['sim', 'live']), accountId: z.string(), currency: z.string(), isTrial: z.boolean(),
          cashBalance: z.number().nullable(), totalValue: z.number().nullable(),
          invested: z.number().describe('Custo das posições abertas (quantidade × preço de abertura)'),
          positions: z.array(z.object({
            positionId: z.string(), instrumentId: z.number().nullable(), symbol: z.string(), name: z.string().nullable(), currency: z.string(),
            quantity: z.number(), openPrice: z.number(), price: z.number().nullable(), marketValue: z.number().nullable(), pnl: z.number().nullable(),
          })),
          closed: z.array(z.object({
            closedPositionId: z.string(), instrumentId: z.number().nullable(), symbol: z.string(), name: z.string().nullable(), currency: z.string(),
            quantity: z.number(), openPrice: z.number().nullable(), closePrice: z.number().nullable(), pnl: z.number().nullable(),
            openedAt: z.string().nullable(), closedAt: z.string().nullable(),
          })),
        }), ...Errors,
      },
    },
  }, async (req) => saxo.getPortfolio(pool, await session(req)));

  app.get('/saxo/portfolio/history', {
    schema: {
      tags: ['SAXO'], summary: 'Evolução do valor da conta SAXO (uma leitura por sessão)',
      description: 'O valor total, o saldo e o valor das posições, tal como a SAXO os dá, guardados no fim de cada sessão, depois da recolha diária.',
      response: {
        200: z.object({
          currency: z.string(), initialCapital: z.number(),
          points: z.array(z.object({ date: IsoDate, total: z.number(), cash: z.number().nullable(), positions: z.number().nullable() })),
        }),
      },
    },
  }, async (req) => ({ ...(await accountHistory(pool, req.user.id)), initialCapital: cfg.saxo.initialCapital }));

  app.get('/saxo/alerts', {
    schema: {
      tags: ['SAXO'], summary: 'Alertas SAXO: avisos de ordens executadas, expiradas ou canceladas e preferência de email',
      response: {
        200: z.object({
          emailEnabled: z.boolean(), canEmail: z.boolean(),
          items: z.array(z.object({
            id: z.number(), orderId: z.number(), kind: z.enum(['ended', 'filled', 'expired', 'cancelled']), symbol: z.string(), side: Side, quantity: z.number(),
            orderType: z.enum(['market', 'limit', 'stop', 'trailing_stop']), limitPrice: z.string().nullable(), stopPrice: z.string().nullable(),
            saxoOrderId: z.string().nullable(), filledQuantity: z.number().nullable(), fillPrice: z.string().nullable(),
            createdAt: z.string(), emailedAt: z.string().nullable(), read: z.boolean(),
          })),
        }),
      },
    },
  }, async (req) => ({ ...(await saxo.alertSettings(pool, req.user.id)), canEmail: Boolean(cfg.alertsPython), items: await saxo.listNotifications(pool, req.user.id) }));

  app.put('/saxo/alerts/settings', {
    schema: { tags: ['SAXO'], summary: 'Receber (ou não) email quando uma ordem SAXO deixa de estar aberta',
      body: z.object({ emailEnabled: z.boolean() }), response: { 200: z.object({ emailEnabled: z.boolean() }) } },
  }, async (req) => {
    await pool.query(
      'INSERT INTO saxo_alert_settings (user_id, email_enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE email_enabled = VALUES(email_enabled)',
      [req.user.id, req.body.emailEnabled ? 1 : 0],
    );
    return { emailEnabled: req.body.emailEnabled };
  });

  app.post('/saxo/alerts/read', {
    schema: { tags: ['SAXO'], summary: 'Marcar todos os avisos como lidos', response: { 204: z.null() } },
  }, async (req, reply) => {
    await pool.query('UPDATE saxo_notifications SET read_at = NOW(3) WHERE user_id = ? AND read_at IS NULL', [req.user.id]);
    return reply.code(204).send(null);
  });

  app.patch('/saxo/orders/:id', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Alterar uma ordem aberta (quantidade e preço limite, ou preço de um stop fixo)',
      params: z.object({ id: Id }),
      body: z.object({ quantity: Quantity.optional(), price: Price.optional() }).refine((b) => b.quantity != null || b.price != null, 'indique a quantidade ou o preço'),
      response: { 200: Order, 400: ErrorBody, ...Errors },
    },
  }, async (req) => saxo.modifyOrder(pool, await session(req), req.params.id, req.body, { wait }));

  app.delete('/saxo/orders/:id', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Cancelar uma ordem aberta', params: z.object({ id: Id }),
      response: { 200: Order, ...Errors },
    },
  }, async (req) => saxo.cancelOrder(pool, await session(req), req.params.id));
}
