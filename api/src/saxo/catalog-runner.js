import { AppError } from '../errors.js';
import { syncInstrument } from './catalog.js';
import { openSession, pickAccount } from './service.js';

/**
 * Ligação do catálogo inteiro à SAXO Bank, em segundo plano: percorre os instrumentos activos, liga os que ainda não têm
 * correspondência e (com `recheck`) revalida os já ligados. Uma de cada vez; progresso em saxo_catalog_runs. Corre com o
 * token SAXO de quem a pede (um administrador). A revalidação semanal usa o administrador da última ligação.
 */

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
const STALE_MS = 3 * 3600_000;   // uma ligação «a correr» há mais de 3 h ficou parada (ex.: reinício da API)
const WEEK_MS = 7 * 24 * 3600_000;
const RATE_PAUSE_MS = 60_000;    // limite de pedidos da SAXO atingido: espera 1 min e repete o instrumento

export async function runningCatalogSync(pool) {
  await pool.query(
    `UPDATE saxo_catalog_runs SET status = 'failed', finished_at = NOW(3), detail = 'interrompida (a API reiniciou?)'
      WHERE status = 'running' AND started_at < NOW(3) - INTERVAL ? SECOND`, [STALE_MS / 1000],
  );
  const [[r]] = await pool.query("SELECT id FROM saxo_catalog_runs WHERE status = 'running' LIMIT 1");
  return r ? Number(r.id) : null;
}

/**
 * Começa uma ligação do catálogo. Valida já o token e a conta (os erros chegam a quem pede); o resto corre em segundo
 * plano. Devolve { id, done } (done: promessa que termina com a ligação; os testes e a linha de comandos esperam-na).
 */
export async function startCatalogSync(pool, cfg, userId, { recheck = false, trigger = 'manual', log = null, sleep = sleepReal } = {}) {
  if (await runningCatalogSync(pool)) throw new AppError(409, 'SAXO_SYNC_RUNNING', 'já está a decorrer uma ligação do catálogo à SAXO Bank');
  const session = await openSession(pool, cfg, userId);
  const account = await pickAccount(session.client);
  const [insts] = await pool.query(
    "SELECT id, symbol, name, exchange, currency, isin, mic FROM instruments WHERE status = 'active' ORDER BY symbol",
  );
  const [ins] = await pool.query(
    'INSERT INTO saxo_catalog_runs (user_id, environment, recheck, trigger_kind, total) VALUES (?, ?, ?, ?, ?)',
    [userId, session.environment, recheck ? 1 : 0, trigger, insts.length],
  );
  const id = ins.insertId;
  const pause = cfg.saxo.catalogPauseMs ?? 0;

  const done = (async () => {
    const counts = {};
    let processed = 0;
    try {
      for (const inst of insts) {
        let status;
        try {
          status = await syncInstrument(pool, session, inst, account.accountKey, { recheck });
        } catch (err) {
          if (err.code !== 'SAXO_RATE_LIMITED') throw err;
          await sleep(RATE_PAUSE_MS);
          status = await syncInstrument(pool, session, inst, account.accountKey, { recheck }).catch((e) => {
            if (e.code === 'SAXO_RATE_LIMITED') return 'error';
            throw e;
          });
        }
        counts[status] = (counts[status] ?? 0) + 1;
        processed += 1;
        await pool.query('UPDATE saxo_catalog_runs SET processed = ?, counts = ? WHERE id = ?', [processed, JSON.stringify(counts), id]);
        if (pause > 0 && status !== 'skipped') await sleep(pause);
      }
      await pool.query("UPDATE saxo_catalog_runs SET status = 'done', finished_at = NOW(3) WHERE id = ?", [id]);
      log?.info?.({ counts }, 'saxo: ligação do catálogo concluída');
    } catch (err) {
      await pool.query("UPDATE saxo_catalog_runs SET status = 'failed', finished_at = NOW(3), detail = ? WHERE id = ?", [String(err.message).slice(0, 500), id]);
      log?.warn?.({ err: err.message }, 'saxo: ligação do catálogo falhou');
    }
  })();
  return { id, done };
}

/**
 * Revalidação semanal (chamada pela vigia da SAXO): se a última ligação concluída tem mais de 7 dias, corre outra com
 * revalidação, com o token do administrador que fez a última. Sem ligações anteriores não faz nada (a primeira é manual).
 */
export async function maybeWeeklyRecheck(pool, cfg, log = null) {
  if (!cfg.saxo.catalogWeekly) return null;
  const [[last]] = await pool.query(
    `SELECT r.user_id, MAX(r.started_at) AS at FROM saxo_catalog_runs r JOIN users u ON u.id = r.user_id AND u.is_admin
      WHERE r.status <> 'failed' GROUP BY r.user_id ORDER BY at DESC LIMIT 1`,
  );
  if (!last?.at || Date.now() - new Date(last.at).getTime() < WEEK_MS) return null;
  const [[failedRecently]] = await pool.query(
    "SELECT 1 AS x FROM saxo_catalog_runs WHERE status = 'failed' AND trigger_kind = 'weekly' AND started_at > NOW(3) - INTERVAL 1 DAY LIMIT 1",
  );
  if (failedRecently) return null; // token caducado, por exemplo: tenta de novo amanhã
  try {
    return await startCatalogSync(pool, cfg, Number(last.user_id), { recheck: true, trigger: 'weekly', log });
  } catch (err) {
    if (err.code !== 'SAXO_SYNC_RUNNING') {
      await pool.query(
        "INSERT INTO saxo_catalog_runs (user_id, recheck, trigger_kind, status, detail, finished_at) VALUES (?, 1, 'weekly', 'failed', ?, NOW(3))",
        [Number(last.user_id), String(err.message).slice(0, 500)],
      );
      log?.warn?.({ err: err.message }, 'saxo: revalidação semanal não começou');
    }
    return null;
  }
}

const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

/** Estado de cada instrumento activo face à SAXO, resumo e última ligação do catálogo. */
export async function catalogStatus(pool, environment) {
  const [rows] = await pool.query(
    `SELECT i.id, i.symbol, i.name, i.exchange, i.isin,
            s.uic, s.saxo_symbol, s.description, s.exchange_id, s.source, s.tradable, s.name_score, s.checked_at,
            m.status AS issue, m.message, m.candidates, m.checked_at AS issue_at
       FROM instruments i
       LEFT JOIN saxo_instruments s ON s.instrument_id = i.id AND s.environment = ?
       LEFT JOIN saxo_match_issues m ON m.instrument_id = i.id AND m.environment = ?
      WHERE i.status = 'active'
      ORDER BY i.symbol`, [environment, environment],
  );
  const items = rows.map((r) => {
    const status = r.issue ?? (r.uic ? (r.tradable ? 'linked' : 'not_tradable') : 'unchecked');
    return {
      instrumentId: Number(r.id), symbol: r.symbol, name: r.name, exchange: r.exchange, isin: r.isin,
      status,
      saxo: r.uic ? {
        uic: Number(r.uic), symbol: r.saxo_symbol, description: r.description, exchangeId: r.exchange_id, source: r.source,
        nameScore: r.name_score == null ? null : Number(r.name_score), checkedAt: r.checked_at?.toISOString() ?? null,
      } : null,
      message: r.message ?? null,
      candidates: r.issue ? parseJson(r.candidates, []) : [],
      issueAt: r.issue_at?.toISOString() ?? null,
    };
  });
  const summary = {};
  for (const it of items) summary[it.status] = (summary[it.status] ?? 0) + 1;
  const [[run]] = await pool.query(
    `SELECT r.id, r.status, r.recheck, r.trigger_kind, r.total, r.processed, r.counts, r.detail, r.started_at, r.finished_at, u.name AS user_name
       FROM saxo_catalog_runs r JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 1`,
  );
  return {
    environment, summary, items,
    lastRun: run ? {
      id: Number(run.id), status: run.status, recheck: Boolean(run.recheck), trigger: run.trigger_kind, total: run.total, processed: run.processed,
      counts: parseJson(run.counts, {}), detail: run.detail, userName: run.user_name,
      startedAt: run.started_at.toISOString(), finishedAt: run.finished_at?.toISOString() ?? null,
    } : null,
  };
}
