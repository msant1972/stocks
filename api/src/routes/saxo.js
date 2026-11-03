import { z } from 'zod';
import { createThrottle } from '../saxo/client.js';
import * as saxo from '../saxo/service.js';
import { ErrorBody, Id } from '../schemas.js';

const Side = z.enum(['buy', 'sell']);
const OrderParams = z.object({
  instrumentId: Id,
  side: Side,
  quantity: z.number().int().min(1).max(10_000_000),
  orderType: z.enum(['market', 'limit']),
  limitPrice: z.string().regex(/^\d+(\.\d{1,6})?$/).optional().describe('Obrigatório nas ordens limitadas'),
});
const Order = z.object({
  id: z.number(), instrumentId: z.number(), symbol: z.string().nullable(), name: z.string().nullable(), environment: z.enum(['sim', 'live']),
  saxoOrderId: z.string().nullable(), side: Side, quantity: z.number(), orderType: z.enum(['market', 'limit']),
  limitPrice: z.string().nullable(), appPrice: z.string().nullable(),
  status: z.enum(['sending', 'working', 'ended', 'cancelled', 'rejected', 'unknown']), message: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string(),
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
      description: 'Resolve o instrumento na SAXO, corre a pré-validação da SAXO e devolve o resumo e um código de confirmação '
        + '(5 minutos) ligado a estes parâmetros. Se houver várias correspondências, 409 SAXO_AMBIGUOUS com os candidatos.',
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

  app.post('/saxo/orders', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Enviar uma ordem pré-validada para a SAXO Bank',
      description: 'Exige o código de confirmação da pré-validação com os mesmos parâmetros. Repetir a idempotencyKey devolve a ordem original.',
      body: OrderParams.extend({
        confirmation: z.string().min(10).max(200),
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
    return saxo.listOrders(pool, s, req.query);
  });

  app.delete('/saxo/orders/:id', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['SAXO'], summary: 'Cancelar uma ordem aberta', params: z.object({ id: Id }),
      response: { 200: Order, ...Errors },
    },
  }, async (req) => saxo.cancelOrder(pool, await session(req), req.params.id));
}
