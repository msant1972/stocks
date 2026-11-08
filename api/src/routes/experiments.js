import { z } from 'zod';
import { audit } from '../db.js';
import { notFound } from '../errors.js';
import { ErrorBody, Id, IsoDate } from '../schemas.js';

const Status = z.enum(['idea', 'running', 'kept', 'dropped'])
  .describe('idea: por começar; running: a decorrer; kept: mantida (funcionou); dropped: abandonada (não funcionou)');
const Experiment = z.object({
  id: z.number(), title: z.string(), status: Status,
  hypothesis: z.string().nullable().describe('O que se espera que aconteça'),
  metric: z.string().nullable().describe('Como se mede se funcionou'),
  result: z.string().nullable().describe('O que se aprendeu, a decisão e porquê'),
  startedOn: IsoDate.nullable(), decidedOn: IsoDate.nullable(),
  createdBy: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
});
// Texto vazio → null; não enviado → undefined (no PATCH, o campo fica como está).
const text = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));
const Fields = {
  title: z.string().trim().min(3).max(160),
  hypothesis: text(4000), metric: text(4000), result: text(8000),
  startedOn: IsoDate.nullable().optional(), decidedOn: IsoDate.nullable().optional(),
};
const Body = z.object({ ...Fields, status: Status.default('idea') });
// Alteração: só os campos enviados (sem valores por omissão, que repunham o estado em «idea»).
const Patch = z.object({ ...Fields, title: Fields.title.optional(), status: Status.optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'nada para alterar');
const COLS = { title: 'title', status: 'status', hypothesis: 'hypothesis', metric: 'metric', result: 'result', startedOn: 'started_on', decidedOn: 'decided_on' };

const SELECT = `SELECT e.id, e.title, e.status, e.hypothesis, e.metric, e.result, e.started_on, e.decided_on, e.created_at, e.updated_at, u.name AS created_by
  FROM experiments e LEFT JOIN users u ON u.id = e.created_by`;
const map = (r) => ({
  id: Number(r.id), title: r.title, status: r.status, hypothesis: r.hypothesis, metric: r.metric, result: r.result,
  startedOn: r.started_on, decidedOn: r.decided_on, createdBy: r.created_by ?? null,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});

/**
 * Laboratório: registo partilhado das experiências feitas no sistema (estratégias, análises, mudanças), com a hipótese,
 * a forma de medir e o que se aprendeu, para as que não funcionaram também ficarem registadas.
 */
export default async function experimentRoutes(app, { pool }) {
  async function byId(id) {
    const [[r]] = await pool.query(`${SELECT} WHERE e.id = ?`, [id]);
    if (!r) throw notFound('Experiência');
    return map(r);
  }

  app.get('/experiments', {
    schema: {
      tags: ['Laboratório'], summary: 'Experiências (a decorrer primeiro, depois as mais recentes)',
      response: { 200: z.object({ items: z.array(Experiment) }) },
    },
  }, async () => {
    const [rows] = await pool.query(
      `${SELECT} ORDER BY FIELD(e.status, 'running', 'idea', 'kept', 'dropped'), COALESCE(e.decided_on, e.started_on, DATE(e.created_at)) DESC, e.id DESC`,
    );
    return { items: rows.map(map) };
  });

  app.post('/experiments', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['Laboratório'], summary: 'Registar uma experiência',
      body: Body, response: { 201: Experiment, 400: ErrorBody },
    },
  }, async (req, reply) => {
    const b = req.body;
    const [res] = await pool.query(
      `INSERT INTO experiments (title, status, hypothesis, metric, result, started_on, decided_on, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.title, b.status, b.hypothesis ?? null, b.metric ?? null, b.result ?? null, b.startedOn ?? null, b.decidedOn ?? null, req.user.id],
    );
    await audit(pool, req.user.id, 'experiment.create', 'experiment', res.insertId, { title: b.title, status: b.status });
    return reply.code(201).send(await byId(res.insertId));
  });

  app.patch('/experiments/:id', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['Laboratório'], summary: 'Alterar uma experiência (estado, resultado, datas…)',
      params: z.object({ id: Id }), body: Patch,
      response: { 200: Experiment, 400: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => {
    const { id } = req.params;
    await byId(id);
    const entries = Object.entries(req.body).filter(([k, v]) => COLS[k] && v !== undefined);
    if (entries.length) {
      await pool.query(`UPDATE experiments SET ${entries.map(([k]) => `${COLS[k]} = ?`).join(', ')} WHERE id = ?`, [...entries.map(([, v]) => v ?? null), id]);
      await audit(pool, req.user.id, 'experiment.update', 'experiment', id, { fields: entries.map(([k]) => k), status: req.body.status ?? undefined });
    }
    return byId(id);
  });

  app.delete('/experiments/:id', {
    schema: {
      tags: ['Laboratório'], summary: 'Apagar uma experiência',
      params: z.object({ id: Id }), response: { 204: z.null(), 404: ErrorBody },
    },
  }, async (req, reply) => {
    const [res] = await pool.query('DELETE FROM experiments WHERE id = ?', [req.params.id]);
    if (!res.affectedRows) throw notFound('Experiência');
    await audit(pool, req.user.id, 'experiment.delete', 'experiment', req.params.id);
    return reply.code(204).send(null);
  });
}
