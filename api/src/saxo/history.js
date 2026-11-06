import { lisbonClock } from './automation.js';
import { openSession } from './service.js';

/**
 * Evolução da carteira: o valor da conta SAXO, tal como a SAXO o dá, guardado uma vez por sessão, depois de a recolha
 * diária fechar essa sessão. A vigia da SAXO chama takeDueSnapshots a cada minuto; sem nada a fazer, só custa duas consultas.
 */

const round2 = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 100) / 100);

/** Valores a guardar a partir de /port/v1/balances/me. O saldo inclui o que ainda está por liquidar, para somar com as posições. */
export function snapshotValues(bal) {
  const total = round2(bal?.TotalValue);
  if (total == null) return null;
  const positions = round2(bal.NonMarginPositionsValue ?? bal.UnrealizedPositionsValueExcludingCostToClosePositions);
  const cash = bal.CashBalance == null ? null : round2(bal.CashBalance + (bal.TransactionsNotBooked ?? 0));
  return { total, cash, positions, currency: bal.Currency ?? 'EUR' };
}

/** A sessão que a recolha diária já fechou, ou null. Nos dias sem sessão (fim-de-semana, feriado) continua a ser a anterior. */
export async function closedSession(pool) {
  const [[q]] = await pool.query("SELECT MAX(last_session) AS d FROM instruments WHERE status = 'active'");
  const [[r]] = await pool.query("SELECT MAX(started_at) AS at FROM job_runs WHERE kind = 'fetch_update' AND status = 'done'");
  if (!q?.d || !r?.at) return null;
  return lisbonClock(new Date(r.at)).date >= q.d ? q.d : null;
}

/** Guarda o valor da conta de cada utilizador ligado à SAXO que ainda não o tem para a sessão fechada. */
export async function takeDueSnapshots(pool, cfg, { log = null } = {}) {
  const session = await closedSession(pool);
  if (!session) return 0;
  const [users] = await pool.query(
    `SELECT t.user_id, t.environment FROM user_integration_tokens t
      WHERE t.provider = 'saxo' AND t.rejected_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM saxo_account_history h WHERE h.user_id = t.user_id AND h.environment = t.environment AND h.session_date = ?)`, [session],
  );
  let saved = 0;
  for (const { user_id: userId } of users) {
    try {
      const s = await openSession(pool, cfg, userId);
      const v = snapshotValues(await s.client.get('/port/v1/balances/me'));
      if (!v) continue;
      await pool.query(
        `INSERT IGNORE INTO saxo_account_history (user_id, environment, session_date, total_value, cash_balance, positions_value, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, [userId, s.environment, session, v.total, v.cash, v.positions, v.currency],
      );
      saved += 1;
    } catch (err) {
      log?.warn?.({ userId, err: err.message }, 'saxo: valor da conta não guardado'); // volta a tentar no minuto seguinte
    }
  }
  return saved;
}

/** Pontos do gráfico da evolução da carteira, do mais antigo para o mais recente. */
export async function accountHistory(pool, userId) {
  const [rows] = await pool.query(
    `SELECT session_date, total_value, cash_balance, positions_value, currency FROM saxo_account_history
      WHERE user_id = ? AND environment = (SELECT COALESCE(MAX(t.environment), 'sim') FROM user_integration_tokens t WHERE t.user_id = ? AND t.provider = 'saxo')
      ORDER BY session_date`, [userId, userId],
  );
  const num = (x) => (x == null ? null : Number(x));
  return {
    currency: rows.at(-1)?.currency ?? 'EUR',
    points: rows.map((r) => ({ date: r.session_date, total: Number(r.total_value), cash: num(r.cash_balance), positions: num(r.positions_value) })),
  };
}
