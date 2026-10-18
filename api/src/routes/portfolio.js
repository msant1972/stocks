import { z } from 'zod';
import { Decimal, ErrorBody, Id, IsoDate, NullableDecimal, Trade } from '../schemas.js';
import { portfolioSummary } from '../services/portfolio.js';
import { executeTrade, listTrades, previewTrade } from '../services/trading.js';

const Position = z.object({
  instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), exchange: z.string().nullable(),
  quantity: z.number(), averageCost: Decimal, costBasis: Decimal,
  price: NullableDecimal, quoteDate: IsoDate.nullable(),
  marketValue: NullableDecimal, unrealizedPnl: NullableDecimal, unrealizedPct: NullableDecimal, realizedPnl: Decimal,
});

const Portfolio = z.object({
  currency: z.string(), initialCapital: Decimal, cashBalance: Decimal, invested: Decimal, marketValue: Decimal,
  totalValue: Decimal, unrealizedPnl: Decimal, realizedPnl: Decimal, totalPnl: Decimal, totalPnlPct: Decimal,
  valuationDate: IsoDate.nullable(), positions: z.array(Position),
});

const Side = z.enum(['buy', 'sell']);
const Quantity = z.coerce.number().int().min(1).max(10_000_000);

export default async function portfolioRoutes(app, { pool, cfg }) {
  app.get('/portfolio', {
    schema: { tags: ['Carteira'], summary: 'Resumo da carteira virtual e posições', response: { 200: Portfolio } },
  }, async (req) => portfolioSummary(pool, req.user.id));

  app.get('/portfolio/positions', {
    schema: { tags: ['Carteira'], summary: 'Posições abertas', response: { 200: z.object({ items: z.array(Position) }) } },
  }, async (req) => ({ items: (await portfolioSummary(pool, req.user.id)).positions }));

  app.get('/simulated-trades/preview', {
    schema: {
      tags: ['Operações'], summary: 'Pré-visualizar uma operação simulada (não grava nada)',
      querystring: z.object({ instrumentId: Id, side: Side, quantity: Quantity }),
      response: {
        200: z.object({
          instrumentId: z.number(), side: Side, quantity: z.number(), currency: z.string(),
          price: Decimal, quoteDate: IsoDate, amount: Decimal, cashAfter: Decimal, quantityAfter: z.number(),
          error: z.object({ code: z.string(), message: z.string() }).nullable(),
        }),
        404: ErrorBody, 409: ErrorBody,
      },
    },
  }, async (req) => previewTrade(pool, req.user.id, req.query, cfg));

  app.post('/simulated-trades', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['Operações'],
      summary: 'Executar compra ou venda simulada ao último fecho disponível',
      description: 'Repetir o pedido com a mesma idempotencyKey devolve a operação original (200) sem a duplicar. '
        + 'Se expectedPrice/expectedQuoteDate não coincidirem com a cotação actual, responde 409 PRICE_CHANGED.',
      body: z.object({
        instrumentId: Id, side: Side, quantity: Quantity,
        idempotencyKey: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
        expectedPrice: z.string().regex(/^\d+(\.\d+)?$/).optional(),
        expectedQuoteDate: IsoDate.optional(),
      }),
      response: { 200: z.object({ trade: Trade, replayed: z.boolean() }), 201: z.object({ trade: Trade, replayed: z.boolean() }), 404: ErrorBody, 409: ErrorBody, 422: ErrorBody },
    },
  }, async (req, reply) => {
    const result = await executeTrade(pool, req.user.id, req.body, cfg);
    return reply.code(result.replayed ? 200 : 201).send(result);
  });

  app.get('/simulated-trades', {
    schema: {
      tags: ['Operações'], summary: 'Histórico de operações simuladas',
      querystring: z.object({
        instrumentId: Id.optional(), side: Side.optional(), from: IsoDate.optional(), to: IsoDate.optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      response: { 200: z.object({ items: z.array(Trade), total: z.number() }) },
    },
  }, async (req) => listTrades(pool, req.user.id, req.query));
}
