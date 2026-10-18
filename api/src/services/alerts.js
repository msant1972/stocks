import { audit, withTransaction } from '../db.js';
import { AppError, notFound } from '../errors.js';

export const ALERT_KINDS = ['close_above', 'close_below', 'change_up', 'change_down'];

/** "150.000000" -> "150"; "2.500000" -> "2.5". */
const trimZeros = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

const SELECT = `
  SELECT r.id, r.instrument_id, i.symbol, i.name, i.currency, r.kind, r.threshold, r.active,
         r.last_evaluated_session, r.created_at, r.updated_at,
         (SELECT MAX(d.finished_at) FROM alert_events e JOIN email_deliveries d ON d.id = e.delivery_id
           WHERE e.rule_id = r.id AND d.status = 'sent') AS last_sent_at,
         (SELECT MAX(e.session_date) FROM alert_events e WHERE e.rule_id = r.id) AS last_event_session
    FROM alert_rules r JOIN instruments i ON i.id = r.instrument_id`;

function mapRule(r) {
  return {
    id: Number(r.id), instrumentId: Number(r.instrument_id), symbol: r.symbol, name: r.name,
    currency: r.currency, kind: r.kind, threshold: trimZeros(r.threshold),
    active: Boolean(r.active), lastEvaluatedSession: r.last_evaluated_session,
    lastEventSession: r.last_event_session, lastSentAt: r.last_sent_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

export async function listRules(pool, userId) {
  const [rows] = await pool.query(`${SELECT} WHERE r.user_id = ? ORDER BY i.symbol, r.id`, [userId]);
  return rows.map(mapRule);
}

async function getRule(conn, userId, id) {
  const [[r]] = await conn.query(`${SELECT} WHERE r.user_id = ? AND r.id = ?`, [userId, id]);
  if (!r) throw notFound('Regra de alerta');
  return mapRule(r);
}

async function checkInstrument(conn, instrumentId) {
  const [[i]] = await conn.query('SELECT status FROM instruments WHERE id = ?', [instrumentId]);
  if (!i) throw notFound('Instrumento');
  if (i.status === 'invalid') throw new AppError(409, 'INSTRUMENT_INVALID', 'o instrumento é inválido');
}

export async function createRule(pool, userId, { instrumentId, kind, threshold }) {
  return withTransaction(pool, async (conn) => {
    await checkInstrument(conn, instrumentId);
    const [res] = await conn.query(
      'INSERT INTO alert_rules (user_id, instrument_id, kind, threshold) VALUES (?, ?, ?, ?)',
      [userId, instrumentId, kind, threshold],
    );
    await audit(conn, userId, 'alert.create', 'alert_rule', res.insertId, { instrumentId, kind, threshold });
    return getRule(conn, userId, res.insertId);
  });
}

/**
 * Alterar a condição ou reactivar a regra repõe last_state a NULL: a próxima avaliação trata a regra
 * como nova, e um alerta de nível que já se verifique é notificado.
 */
export async function updateRule(pool, userId, id, patch) {
  return withTransaction(pool, async (conn) => {
    const [[cur]] = await conn.query('SELECT kind, threshold, active FROM alert_rules WHERE id = ? AND user_id = ? FOR UPDATE', [id, userId]);
    if (!cur) throw notFound('Regra de alerta');
    const kind = patch.kind ?? cur.kind;
    const threshold = patch.threshold ?? cur.threshold;
    const active = patch.active ?? Boolean(cur.active);
    const reset = kind !== cur.kind || Number(threshold) !== Number(cur.threshold) || (active && !cur.active);
    await conn.query(
      `UPDATE alert_rules SET kind = ?, threshold = ?, active = ?${reset ? ', last_state = NULL, last_evaluated_session = NULL' : ''}
        WHERE id = ?`,
      [kind, threshold, active, id],
    );
    await audit(conn, userId, 'alert.update', 'alert_rule', id, patch);
    return getRule(conn, userId, id);
  });
}

export async function deleteRule(pool, userId, id) {
  await withTransaction(pool, async (conn) => {
    const [res] = await conn.query('DELETE FROM alert_rules WHERE id = ? AND user_id = ?', [id, userId]);
    if (res.affectedRows === 0) throw notFound('Regra de alerta');
    await audit(conn, userId, 'alert.delete', 'alert_rule', id);
  });
}

export async function listEvents(pool, userId, limit) {
  const [rows] = await pool.query(
    `SELECT e.id, e.rule_id, r.kind, r.threshold, i.symbol, e.session_date, e.close, e.change_pct,
            d.status AS delivery_status, d.finished_at AS delivered_at
       FROM alert_events e
       JOIN alert_rules r ON r.id = e.rule_id
       JOIN instruments i ON i.id = r.instrument_id
       LEFT JOIN email_deliveries d ON d.id = e.delivery_id
      WHERE r.user_id = ?
      ORDER BY e.session_date DESC, e.id DESC LIMIT ?`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id), ruleId: Number(r.rule_id), kind: r.kind, threshold: trimZeros(r.threshold), symbol: r.symbol,
    sessionDate: r.session_date, close: r.close, changePct: r.change_pct,
    deliveryStatus: r.delivery_status ?? 'pending', deliveredAt: r.delivered_at?.toISOString() ?? null,
  }));
}
