import { z } from 'zod';
import { IsoDate } from '../schemas.js';

const CACHE_MS = 10 * 60_000; // as cotações só mudam com a recolha diária
const NEUTRAL_BAND = 1;       // % — a mesma zona neutra da estratégia

const Entry = z.object({
  instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), close: z.string(), momentumPct: z.string(),
});

/**
 * Momento do mercado: SMA10/SMA200 − 1 na última sessão de cada instrumento activo com SMA200.
 * Distribuição acima de +1%, entre −1% e +1% (inclusive) e abaixo de −1%, e os N extremos.
 */
async function computeMomentum(pool) {
  const [rows] = await pool.query(
    `SELECT i.id, i.symbol, i.name, q.close, q.session_date, (q.sma10 / q.sma200 - 1) * 100 AS mom
       FROM instruments i
       JOIN daily_quotes q ON q.instrument_id = i.id AND q.session_date = i.last_session
      WHERE i.status = 'active' AND q.sma10 IS NOT NULL AND q.sma200 IS NOT NULL AND q.sma200 > 0
      ORDER BY mom DESC, i.symbol`,
  );
  return rows.map((r) => ({
    instrumentId: Number(r.id), symbol: r.symbol, name: r.name, close: r.close,
    sessionDate: r.session_date, mom: Number(r.mom),
  }));
}

export default async function marketRoutes(app, { pool }) {
  let cache = null;

  app.get('/market/momentum', {
    schema: {
      tags: ['Mercado'], summary: 'Momento do catálogo (SMA10/SMA200 na última sessão): distribuição e extremos',
      querystring: z.object({ top: z.coerce.number().int().min(1).max(20).default(5) }),
      response: {
        200: z.object({
          latestSession: IsoDate.nullable(),
          total: z.number(), above: z.number(), neutral: z.number(), below: z.number(),
          strongest: z.array(Entry), weakest: z.array(Entry),
        }),
      },
    },
  }, async (req) => {
    if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), rows: await computeMomentum(pool) };
    const { rows } = cache;
    const entry = (r) => ({ instrumentId: r.instrumentId, symbol: r.symbol, name: r.name, close: r.close, momentumPct: r.mom.toFixed(2) });
    const { top } = req.query;
    return {
      latestSession: rows.reduce((m, r) => (r.sessionDate > (m ?? '') ? r.sessionDate : m), null),
      total: rows.length,
      above: rows.filter((r) => r.mom > NEUTRAL_BAND).length,
      neutral: rows.filter((r) => Math.abs(r.mom) <= NEUTRAL_BAND).length,
      below: rows.filter((r) => r.mom < -NEUTRAL_BAND).length,
      strongest: rows.slice(0, top).map(entry),
      weakest: rows.slice(-top).reverse().map(entry),
    };
  });
}
