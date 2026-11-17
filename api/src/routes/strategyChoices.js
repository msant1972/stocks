import { z } from 'zod';
import { AVAILABLE_STRATEGIES } from '../../../shared/strategies/index.js';
import { audit } from '../db.js';
import { notFound } from '../errors.js';
import { ErrorBody, Id } from '../schemas.js';
import { assertEnabled } from '../services/strategySettings.js';

/**
 * Estratégia escolhida para cada instrumento, por utilizador (tabela instrument_strategy_choices). Escolhe-se no menu
 * «Estratégia» do Charts; é a que a Automação usa para comprar nesse instrumento e a que filtra os Sinais. Sem escolha, vale a
 * melhor estratégia ligada (shared/strategies/choice.js).
 */
export default async function strategyChoiceRoutes(app, { pool }) {
  app.get('/strategy-choices', {
    schema: {
      tags: ['Estratégia'], summary: 'Estratégias escolhidas pelo utilizador, por instrumento',
      description: 'strategyId null = «Nenhuma» (o utilizador escolheu não negociar o instrumento). Os instrumentos sem linha usam a melhor estratégia ligada.',
      response: { 200: z.object({ items: z.array(z.object({ instrumentId: z.number(), strategyId: z.string().nullable(), updatedAt: z.string() })) }) },
    },
  }, async (req) => {
    const [rows] = await pool.query('SELECT instrument_id, strategy_id, updated_at FROM instrument_strategy_choices WHERE user_id = ? ORDER BY instrument_id', [req.user.id]);
    return { items: rows.map((r) => ({ instrumentId: Number(r.instrument_id), strategyId: r.strategy_id ?? null, updatedAt: new Date(r.updated_at).toISOString() })) };
  });

  const Params = z.object({ id: Id });
  async function assertInstrument(id) {
    const [[i]] = await pool.query('SELECT id FROM instruments WHERE id = ?', [id]);
    if (!i) throw notFound('Instrumento');
  }

  app.put('/instruments/:id/strategy', {
    schema: {
      tags: ['Estratégia'], summary: 'Escolher a estratégia de um instrumento',
      description: 'strategyId: uma estratégia ligada, ou null para «Nenhuma» (a Automação não compra este instrumento e os Sinais não o mostram).',
      params: Params,
      body: z.object({ strategyId: z.enum(AVAILABLE_STRATEGIES.map((s) => s.id)).nullable() }),
      response: { 204: z.null(), 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req, reply) => {
    const { id } = req.params;
    const { strategyId } = req.body;
    await assertInstrument(id);
    if (strategyId !== null) await assertEnabled(pool, strategyId);
    await pool.query(
      `INSERT INTO instrument_strategy_choices (user_id, instrument_id, strategy_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE strategy_id = VALUES(strategy_id)`,
      [req.user.id, id, strategyId],
    );
    await audit(pool, req.user.id, 'strategy.choice', 'instrument', id, { strategyId });
    return reply.code(204).send(null);
  });

  app.delete('/instruments/:id/strategy', {
    schema: {
      tags: ['Estratégia'], summary: 'Voltar à escolha automática (a melhor estratégia ligada do instrumento)',
      params: Params, response: { 204: z.null(), 404: ErrorBody },
    },
  }, async (req, reply) => {
    const { id } = req.params;
    await assertInstrument(id);
    const [r] = await pool.query('DELETE FROM instrument_strategy_choices WHERE user_id = ? AND instrument_id = ?', [req.user.id, id]);
    if (r.affectedRows) await audit(pool, req.user.id, 'strategy.choice', 'instrument', id, { strategyId: 'auto' });
    return reply.code(204).send(null);
  });
}
