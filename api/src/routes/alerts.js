import { z } from 'zod';
import { AlertKind, AlertRule, Decimal, ErrorBody, Id, IsoDate, NullableDecimal, PositiveDecimalInput } from '../schemas.js';
import { createRule, deleteRule, listEvents, listRules, updateRule } from '../services/alerts.js';

export default async function alertRoutes(app, { pool }) {
  app.get('/alerts', {
    schema: { tags: ['Alertas'], summary: 'Regras de alerta do utilizador', response: { 200: z.object({ items: z.array(AlertRule) }) } },
  }, async (req) => ({ items: await listRules(pool, req.user.id) }));

  app.post('/alerts', {
    schema: {
      tags: ['Alertas'], summary: 'Criar regra de alerta',
      description: 'close_above/close_below: limite em EUR, notificado quando a condição passa a verificar-se. '
        + 'change_up/change_down: variação percentual face à sessão anterior, avaliada em cada sessão.',
      body: z.object({ instrumentId: Id, kind: AlertKind, threshold: PositiveDecimalInput }),
      response: { 201: AlertRule, 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req, reply) => reply.code(201).send(await createRule(pool, req.user.id, req.body)));

  app.patch('/alerts/:id', {
    schema: {
      tags: ['Alertas'], summary: 'Editar, activar ou desactivar regra',
      params: z.object({ id: Id }),
      body: z.object({ kind: AlertKind.optional(), threshold: PositiveDecimalInput.optional(), active: z.boolean().optional() }),
      response: { 200: AlertRule, 404: ErrorBody },
    },
  }, async (req) => updateRule(pool, req.user.id, req.params.id, req.body));

  app.delete('/alerts/:id', {
    schema: { tags: ['Alertas'], summary: 'Apagar regra', params: z.object({ id: Id }), response: { 204: z.null(), 404: ErrorBody } },
  }, async (req, reply) => {
    await deleteRule(pool, req.user.id, req.params.id);
    return reply.code(204).send(null);
  });

  app.get('/alerts/events', {
    schema: {
      tags: ['Alertas'], summary: 'Eventos recentes e estado do envio',
      querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
      response: {
        200: z.object({
          items: z.array(z.object({
            id: z.number(), ruleId: z.number(), kind: AlertKind, threshold: Decimal, symbol: z.string(),
            sessionDate: IsoDate, close: Decimal, changePct: NullableDecimal,
            deliveryStatus: z.enum(['pending', 'sending', 'sent', 'failed', 'uncertain']), deliveredAt: z.string().nullable(),
          })),
        }),
      },
    },
  }, async (req) => ({ items: await listEvents(pool, req.user.id, req.query.limit) }));
}
