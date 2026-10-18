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

  // ---------- Cruzamentos SMA10 / SMA50 ----------

  const Cross = z.object({
    instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(),
    crossDate: IsoDate, sessionsAgo: z.number(), close: z.string(),
    sma10: z.string(), sma50: z.string(), gapPct: z.string().describe('SMA10/SMA50 − 1 na última sessão, em %'),
  });
  const crossCache = new Map(); // sessões -> { at, payload }

  app.get('/market/crossovers', {
    schema: {
      tags: ['Mercado'], summary: 'Instrumentos cuja SMA10 cruzou a SMA50 nas últimas N sessões',
      description: 'Ascendente: SMA10 ≤ SMA50 na sessão anterior e SMA10 > SMA50 na sessão do cruzamento; '
        + 'descendente: o inverso. Por instrumento conta o cruzamento mais recente dentro da janela.',
      querystring: z.object({ sessions: z.coerce.number().int().min(1).max(20).default(5) }),
      response: {
        200: z.object({ sessions: z.number(), latestSession: IsoDate.nullable(), up: z.array(Cross), down: z.array(Cross) }),
      },
    },
  }, async (req) => {
    const { sessions } = req.query;
    const hit = crossCache.get(sessions);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.payload;
    const [rows] = await pool.query(
      `WITH r AS (
         SELECT q.instrument_id, q.session_date, q.sma10, q.sma50,
                LAG(q.sma10) OVER w AS prev10, LAG(q.sma50) OVER w AS prev50,
                ROW_NUMBER() OVER (PARTITION BY q.instrument_id ORDER BY q.session_date DESC) AS rn
           FROM daily_quotes q JOIN instruments i ON i.id = q.instrument_id
          WHERE i.status = 'active' AND q.session_date >= i.last_session - INTERVAL ? DAY
         WINDOW w AS (PARTITION BY q.instrument_id ORDER BY q.session_date)
       ), crosses AS (
         SELECT instrument_id, session_date, rn,
                CASE WHEN prev10 <= prev50 AND sma10 > sma50 THEN 'up' ELSE 'down' END AS dir,
                ROW_NUMBER() OVER (PARTITION BY instrument_id ORDER BY session_date DESC) AS k
           FROM r
          WHERE rn <= ? AND prev10 IS NOT NULL AND prev50 IS NOT NULL AND sma10 IS NOT NULL AND sma50 IS NOT NULL
            AND ((prev10 <= prev50 AND sma10 > sma50) OR (prev10 >= prev50 AND sma10 < sma50))
       )
       SELECT c.instrument_id, c.session_date AS cross_date, c.rn, c.dir, i.symbol, i.name,
              l.close, l.sma10, l.sma50, l.session_date AS last_date
         FROM crosses c
         JOIN instruments i ON i.id = c.instrument_id
         JOIN daily_quotes l ON l.instrument_id = c.instrument_id AND l.session_date = i.last_session
        WHERE c.k = 1
        ORDER BY c.session_date DESC, i.symbol`,
      // Janela em dias de calendário com folga para fins-de-semana e feriados.
      [Math.ceil(sessions * 1.6) + 10, sessions],
    );
    const entry = (r) => ({
      instrumentId: Number(r.instrument_id), symbol: r.symbol, name: r.name,
      crossDate: r.cross_date, sessionsAgo: Number(r.rn) - 1, close: r.close, sma10: r.sma10, sma50: r.sma50,
      gapPct: ((Number(r.sma10) / Number(r.sma50) - 1) * 100).toFixed(2),
    });
    const payload = {
      sessions,
      latestSession: rows.reduce((m, r) => (r.last_date > (m ?? '') ? r.last_date : m), null),
      up: rows.filter((r) => r.dir === 'up').map(entry),
      down: rows.filter((r) => r.dir === 'down').map(entry),
    };
    crossCache.set(sessions, { at: Date.now(), payload });
    return payload;
  });
}
