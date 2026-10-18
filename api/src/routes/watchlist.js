import { z } from 'zod';
import { AppError, notFound } from '../errors.js';
import { ErrorBody, Id, InstrumentSummary } from '../schemas.js';
import { latestQuotes } from '../services/quotes.js';
import { INSTRUMENT_SELECT, mapInstrument } from './instruments.js';

export default async function watchlistRoutes(app, { pool }) {
  app.get('/watchlist', {
    schema: {
      tags: ['Watchlist'], summary: 'Instrumentos acompanhados pelo utilizador',
      response: { 200: z.object({ items: z.array(InstrumentSummary) }) },
    },
  }, async (req) => {
    const [rows] = await pool.query(
      `${INSTRUMENT_SELECT} JOIN watchlist_items w ON w.instrument_id = i.id AND w.user_id = ?
        ORDER BY i.symbol`,
      [req.user.id, req.user.id],
    );
    const quotes = await latestQuotes(pool, rows.map((r) => r.id));
    return { items: rows.map((r) => mapInstrument(r, quotes)) };
  });

  app.post('/watchlist/items', {
    schema: {
      tags: ['Watchlist'], summary: 'Acompanhar um instrumento do catálogo',
      body: z.object({ instrumentId: Id }),
      response: { 204: z.null(), 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req, reply) => {
    const [[i]] = await pool.query('SELECT status FROM instruments WHERE id = ?', [req.body.instrumentId]);
    if (!i) throw notFound('Instrumento');
    if (i.status === 'invalid') throw new AppError(409, 'INSTRUMENT_INVALID', 'o instrumento é inválido');
    await pool.query('INSERT IGNORE INTO watchlist_items (user_id, instrument_id) VALUES (?, ?)', [req.user.id, req.body.instrumentId]);
    return reply.code(204).send(null);
  });

  app.delete('/watchlist/items/:instrumentId', {
    schema: {
      tags: ['Watchlist'], summary: 'Deixar de acompanhar',
      params: z.object({ instrumentId: Id }),
      response: { 204: z.null(), 404: ErrorBody },
    },
  }, async (req, reply) => {
    const [res] = await pool.query('DELETE FROM watchlist_items WHERE user_id = ? AND instrument_id = ?', [req.user.id, req.params.instrumentId]);
    if (res.affectedRows === 0) throw notFound('Instrumento na lista');
    return reply.code(204).send(null);
  });
}
