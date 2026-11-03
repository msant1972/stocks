/**
 * Sinais das estratégias para o motor de alertas (engines/alerts, regras «signal»). Para cada par (instrumento,
 * estratégia) das regras de sinal activas, corre a estratégia do registo (como GET /signals), só sobre sessões
 * definitivas, e escreve em JSON os sinais das últimas sessões:
 *   [{ instrumentId, strategy, signals: [{ date, side, price, reason }] }]
 * Só lê a base de dados. Chamado pelo motor de alertas a partir de api/ (cwd), com o ambiente da aplicação.
 *
 *   cd api && node --env-file=../.env ../scripts/strategy-signals.mjs
 */
import { createPool } from '../api/src/db.js';
import { loadConfig } from '../api/src/config.js';
import { yearsBefore } from '../api/src/routes/instruments.js';
import { momentum } from '../shared/momentum.js';
import { getStrategy } from '../shared/strategies/index.js';

const SESSIONS = 15; // sinais das últimas sessões (cobre a recuperação de sessões em atraso do motor de alertas)

const pool = createPool(loadConfig().db);
try {
  const [pairs] = await pool.query(
    `SELECT DISTINCT r.instrument_id, r.strategy FROM alert_rules r JOIN instruments i ON i.id = r.instrument_id
      WHERE r.kind = 'signal' AND r.active AND i.status = 'active' ORDER BY r.instrument_id`,
  );
  const out = [];
  for (const { instrument_id: id, strategy: sid } of pairs) {
    const st = getStrategy(sid);
    if (!st) continue;
    const [quotes] = await pool.query(
      `SELECT session_date AS date, open, high, low, close, adj_close AS adjClose, volume, sma10, sma125, sma200
         FROM daily_quotes WHERE instrument_id = ? AND NOT provisional ORDER BY session_date`,
      [id],
    );
    if (!quotes.length) continue;
    const last = quotes.at(-1).date;
    const from = st.warmupYears > 0 ? yearsBefore(last, st.windowYears) : undefined;
    const r = st.run(quotes, { mom: momentum(quotes), from });
    const since = quotes[Math.max(0, quotes.length - SESSIONS)].date;
    out.push({
      instrumentId: Number(id), strategy: sid,
      signals: r.signals.filter((s) => s.date >= since).map((s) => ({ date: s.date, side: s.side, price: s.price ?? null, reason: s.reason ?? null })),
    });
  }
  process.stdout.write(JSON.stringify(out));
} finally {
  await pool.end();
}
