import { z } from 'zod';
import { IsoDate } from '../schemas.js';

export const HEATMAP_PERIODS = [1, 5, 10, 20];

const CACHE_MS = 10 * 60_000; // as cotações só mudam com a recolha diária

/**
 * Mapa de calor do catálogo: por instrumento activo, a variação nas últimas N sessões e o valor
 * negociado (Σ preço × volume) nessas sessões.
 *   variação = fecho ajustado da última sessão / fecho ajustado N sessões antes − 1
 *   valor    = soma de close × volume das N sessões (fecho real, não ajustado)
 * Instrumentos com menos de N+1 sessões ou sem volume ficam de fora.
 */
async function computeHeatmap(pool, period) {
  const [rows] = await pool.query(
    `WITH ranked AS (
       SELECT q.instrument_id, q.session_date, q.close, COALESCE(q.adj_close, q.close) AS adj, q.volume,
              ROW_NUMBER() OVER (PARTITION BY q.instrument_id ORDER BY q.session_date DESC) AS rn
         FROM daily_quotes q
         JOIN instruments i ON i.id = q.instrument_id
        WHERE i.status = 'active'
          AND q.session_date >= COALESCE(i.last_session, CURRENT_DATE) - INTERVAL ? DAY
     )
     SELECT r.instrument_id, i.symbol, i.name, i.exchange,
            MAX(CASE WHEN r.rn = 1 THEN r.session_date END) AS to_date,
            MAX(CASE WHEN r.rn = ? + 1 THEN r.session_date END) AS from_date,
            MAX(CASE WHEN r.rn = 1 THEN r.close END) AS close,
            MAX(CASE WHEN r.rn = 1 THEN r.adj END) AS adj_last,
            MAX(CASE WHEN r.rn = ? + 1 THEN r.adj END) AS adj_first,
            SUM(CASE WHEN r.rn <= ? THEN r.close * r.volume ELSE 0 END) AS traded
       FROM ranked r JOIN instruments i ON i.id = r.instrument_id
      WHERE r.rn <= ? + 1
      GROUP BY r.instrument_id, i.symbol, i.name, i.exchange
     HAVING adj_first IS NOT NULL AND adj_first > 0 AND traded > 0
      ORDER BY traded DESC`,
    // Janela em dias de calendário com folga para fins-de-semana e feriados (20 sessões → 42 dias).
    [Math.ceil(period * 1.6) + 10, period, period, period, period],
  );
  return rows.map((r) => ({
    instrumentId: Number(r.instrument_id), symbol: r.symbol, name: r.name, exchange: r.exchange,
    fromDate: r.from_date, toDate: r.to_date, close: r.close,
    changePct: ((Number(r.adj_last) / Number(r.adj_first) - 1) * 100).toFixed(2),
    tradedValue: Number(r.traded).toFixed(0),
  }));
}

export default async function heatmapRoutes(app, { pool }) {
  const cache = new Map(); // período -> { at, items }
  app.get('/heatmap', {
    schema: {
      tags: ['Mapa de calor'], summary: 'Variação e valor negociado por instrumento no período',
      querystring: z.object({
        period: z.coerce.number().int().refine((p) => HEATMAP_PERIODS.includes(p), 'período deve ser 1, 5, 10 ou 20').default(5),
        scope: z.enum(['all', 'watchlist']).default('all'),
        limit: z.coerce.number().int().min(1).max(500).default(20).describe('Só os N instrumentos com maior valor negociado'),
      }),
      response: {
        200: z.object({
          period: z.number(),
          total: z.number().describe('Instrumentos disponíveis antes do limite'),
          latestSession: IsoDate.nullable(),
          items: z.array(z.object({
            instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), exchange: z.string().nullable(),
            logoVersion: z.number().nullable().describe('Versão do logotipo interno (GET /instruments/{id}/logo?v=); null sem logotipo'),
            fromDate: IsoDate, toDate: IsoDate, close: z.string(), changePct: z.string(), tradedValue: z.string(),
          })),
        }),
      },
    },
  }, async (req) => {
    const { period, scope, limit } = req.query;
    let hit = cache.get(period);
    if (!hit || Date.now() - hit.at > CACHE_MS) {
      hit = { at: Date.now(), items: await computeHeatmap(pool, period) };
      cache.set(period, hit);
    }
    let { items } = hit;
    if (scope === 'watchlist') {
      const [w] = await pool.query('SELECT instrument_id FROM watchlist_items WHERE user_id = ?', [req.user.id]);
      const ids = new Set(w.map((r) => Number(r.instrument_id)));
      items = items.filter((i) => ids.has(i.instrumentId));
    }
    const total = items.length;
    items = items.slice(0, limit); // já ordenados por valor negociado, do maior para o menor
    // Logotipos fora da cache: um logotipo acabado de carregar aparece logo.
    const versions = new Map();
    if (items.length) {
      const [lg] = await pool.query("SELECT instrument_id, updated_at FROM instrument_logos WHERE status = 'ok' AND instrument_id IN (?)", [items.map((i) => i.instrumentId)]);
      for (const r of lg) versions.set(Number(r.instrument_id), new Date(r.updated_at).getTime());
    }
    items = items.map((i) => ({ ...i, logoVersion: versions.get(i.instrumentId) ?? null }));
    return { period, total, latestSession: items.reduce((m, i) => (i.toDate > (m ?? '') ? i.toDate : m), null), items };
  });
}
