import { ratio, toScaled } from '../money.js';

/**
 * Último fecho e fecho anterior de cada instrumento, numa só consulta.
 * Devolve Map(instrumentId -> { date, close, volume, previousDate, previousClose, changePct }).
 */
export async function latestQuotes(conn, instrumentIds) {
  const ids = [...new Set(instrumentIds.map(Number))];
  const out = new Map();
  if (ids.length === 0) return out;
  const [rows] = await conn.query(
    `SELECT q.instrument_id, q.session_date, q.close, q.volume,
            (SELECT p.session_date FROM daily_quotes p
              WHERE p.instrument_id = q.instrument_id AND p.session_date < q.session_date
              ORDER BY p.session_date DESC LIMIT 1) AS previous_date,
            (SELECT p.close FROM daily_quotes p
              WHERE p.instrument_id = q.instrument_id AND p.session_date < q.session_date
              ORDER BY p.session_date DESC LIMIT 1) AS previous_close
       FROM instruments i
       JOIN daily_quotes q ON q.instrument_id = i.id AND q.session_date = i.last_session
      WHERE i.id IN (?)`,
    [ids],
  );
  for (const r of rows) {
    out.set(Number(r.instrument_id), {
      date: r.session_date,
      close: r.close,
      volume: r.volume == null ? null : Number(r.volume),
      previousDate: r.previous_date,
      previousClose: r.previous_close,
      changePct: r.previous_close ? changePct(r.close, r.previous_close) : null,
    });
  }
  return out;
}

/** Variação percentual com 2 casas, ex.: "2.35" ou "-1.10". */
export function changePct(close, previousClose) {
  const prev = toScaled(previousClose, 6);
  if (prev === 0n) return null;
  return ratio((toScaled(close, 6) - prev) * 100n, prev, 2);
}

/** Dias de calendário entre uma data 'AAAA-MM-DD' e hoje (UTC). */
export function ageInDays(date, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
}
