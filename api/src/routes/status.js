import { z } from 'zod';
import { IsoDate } from '../schemas.js';

const Run = z.object({ status: z.enum(['running', 'done', 'failed']), startedAt: z.string(), finishedAt: z.string().nullable(), detail: z.string().nullable() }).nullable();

export default async function statusRoutes(app, { pool }) {
  app.get('/status', {
    schema: {
      tags: ['Operação'], summary: 'Estado dos dados: última sessão, recolhas e alertas',
      response: {
        200: z.object({
          latestSession: IsoDate.nullable(),
          instruments: z.object({ pending: z.number(), active: z.number(), invalid: z.number() }),
          failedJobs: z.number(),
          lastFetchRun: Run,
          lastAlertsRun: Run,
        }),
      },
    },
  }, async () => {
    const [counts] = await pool.query('SELECT status, COUNT(*) AS n FROM instruments GROUP BY status');
    const instruments = { pending: 0, active: 0, invalid: 0 };
    for (const c of counts) instruments[c.status] = Number(c.n);
    const [[{ latest }]] = await pool.query("SELECT MAX(last_session) AS latest FROM instruments WHERE status = 'active'");
    // Pedidos falhados cujo instrumento continua activo (falhas definitivas de actualização).
    const [[{ failed }]] = await pool.query(
      `SELECT COUNT(*) AS failed FROM fetch_jobs j JOIN instruments i ON i.id = j.instrument_id
        WHERE j.status = 'failed' AND i.status = 'active' AND j.created_at > NOW(3) - INTERVAL 7 DAY`,
    );
    const lastRun = async (kind) => {
      const [[r]] = await pool.query('SELECT status, started_at, finished_at, detail FROM job_runs WHERE kind = ? ORDER BY id DESC LIMIT 1', [kind]);
      return r ? { status: r.status, startedAt: r.started_at.toISOString(), finishedAt: r.finished_at?.toISOString() ?? null, detail: r.detail } : null;
    };
    return {
      latestSession: latest, instruments, failedJobs: Number(failed),
      lastFetchRun: await lastRun('fetch_update'), lastAlertsRun: await lastRun('alerts'),
    };
  });
}
