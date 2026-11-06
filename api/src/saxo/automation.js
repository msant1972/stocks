import { AVAILABLE_STRATEGIES, getStrategy } from '../../../shared/strategies/index.js';
import { audit } from '../db.js';
import { buildItems, computeAll } from '../services/signals.js';
import { storedResolution } from './catalog.js';
import { createThrottle } from './client.js';
import { getPortfolio, listOrders, openSession, parseScheme, pickAccount, placeOrder } from './service.js';
import { nearestTick } from './ticks.js';

/**
 * Automação: lê os sinais das estratégias ligadas e envia as ordens à conta de SIMULAÇÃO da SAXO, sem intervenção.
 *
 * Quando: de hora a hora nos dias úteis, 10 minutos depois de cada recolha horária do Yahoo (08:23 a 17:23 → 08:33 a 17:33 de
 * Lisboa). Que sinais: os da sessão em curso, calculados com os últimos dados, e os da última sessão. Um sinal da sessão em
 * curso pode depender de um fecho que ainda vai mudar: uma vez enviado, a ordem fica, mesmo que o sinal desapareça depois.
 * Ordens, ambas do dia: compra limitada a último preço + 1 %, com o orçamento da estratégia; venda a mercado do que a
 * automação comprou para essa estratégia (no máximo o que a conta tem), nunca de posições manuais ou de outra estratégia.
 * Um sinal nunca se envia duas vezes: saxo_automation_orders tem um registo único por sinal e a chave de idempotência da
 * ordem deriva do sinal.
 */

export const BUY_LIMIT_MARKUP = 0.01;
const FIRST_HOUR = 8;   // recolhas horárias: 08:23 a 17:23 (deploy/systemd/stocks-intraday.timer)
const LAST_HOUR = 17;
const SLOT_FROM = 33;   // 10 minutos depois da recolha
const SLOT_TO = 53;     // sem recolha até aqui, esta hora fica sem execução
const LATE_MINUTE = 50; // a partir daqui, a falta da recolha da hora fica registada como falha
const RETRY_MS = 5 * 60_000;  // depois de uma falha (ex.: ligação expirada), volta a tentar dentro da janela
const STUCK_MS = 15 * 60_000; // «a correr» há mais do que isto: a API reiniciou a meio

/** Data, hora e dia da semana em Lisboa. */
export function lisbonClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday: parts.weekday };
}

/** Hora da execução em curso (8 a 17), ou null fora dos 20 minutos a seguir aos 10 minutos depois de cada recolha. */
export function runSlot({ time, weekday }) {
  if (['Sat', 'Sun'].includes(weekday)) return null;
  const [hour, minute] = time.split(':').map(Number);
  return hour >= FIRST_HOUR && hour <= LAST_HOUR && minute >= SLOT_FROM && minute < SLOT_TO ? hour : null;
}

/** Preço limite de uma compra: último preço + 1 %, no passo de preço do instrumento (sem esquema conhecido, 4 casas). */
export function buyLimit(lastPrice, scheme = null) {
  const raw = Number(lastPrice) * (1 + BUY_LIMIT_MARKUP);
  return (scheme && nearestTick(scheme, raw)) || String(Number(raw.toFixed(4)));
}

/** Unidades que o orçamento compra ao último preço (0 se não chegar para uma). */
export const buyQuantity = (budget, lastPrice) => (Number(lastPrice) > 0 ? Math.floor(budget / Number(lastPrice)) : 0);

/** Sinais a tratar: os da sessão em curso e os da última sessão; vendas primeiro (libertam saldo). */
export function selectSignals(items, { lastFinal, today }) {
  return items.filter((s) => s.date === lastFinal || s.date === today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.side === 'sell' ? 0 : 1) - (b.side === 'sell' ? 0 : 1) || a.symbol.localeCompare(b.symbol));
}

/** Chave de idempotência da ordem, igual em qualquer repetição do mesmo sinal. */
export const signalKey = (s, strategyId) => `auto-${strategyId}-${s.instrumentId}-${s.date.replaceAll('-', '')}-${s.side}`;

/** Unidades que a automação tem de uma estratégia num instrumento: compras executadas menos vendas executadas. */
async function strategyHolding(pool, userId, strategyId, instrumentId) {
  const [[r]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN o.side = 'buy' THEN COALESCE(o.filled_quantity, 0) ELSE -COALESCE(o.filled_quantity, 0) END), 0) AS qty
       FROM saxo_automation_orders a JOIN saxo_orders o ON o.id = a.order_id
      WHERE a.user_id = ? AND a.strategy_id = ? AND a.instrument_id = ?`,
    [userId, strategyId, instrumentId],
  );
  return Number(r.qty);
}

/** A sessão fechada mais recente e se a recolha diária já a confirmou (senão os seus valores podem ser provisórios). */
export async function lastFinalSession(pool, today) {
  const [[q]] = await pool.query(
    `SELECT MAX(q.session_date) AS d FROM daily_quotes q JOIN instruments i ON i.id = q.instrument_id
      WHERE i.status = 'active' AND q.session_date < ?`, [today],
  );
  const [[r]] = await pool.query("SELECT MAX(started_at) AS at FROM job_runs WHERE kind = 'fetch_update' AND status = 'done'");
  const confirmed = Boolean(q?.d && r?.at && lisbonClock(new Date(r.at)).date >= q.d);
  return { lastFinal: q?.d ?? null, confirmed };
}

const FATAL = new Set(['SAXO_TOKEN_EXPIRED', 'SAXO_NO_TOKEN', 'SAXO_LIVE_BLOCKED']);

/** Trata um sinal; devolve o resultado para as contagens. Erros de ligação sobem e param a execução (sem registar o sinal). */
async function handleSignal(pool, cfg, session, s, strategy, { getHeld, wait }) {
  const userId = session.userId;
  const unique = [userId, strategy.id, s.instrumentId, s.date, s.side];
  const [[seen]] = await pool.query(
    'SELECT id, outcome FROM saxo_automation_orders WHERE user_id = ? AND strategy_id = ? AND instrument_id = ? AND signal_date = ? AND signal_side = ?', unique,
  );
  if (seen && seen.outcome !== 'pending') return 'already';
  let id = seen?.id;
  if (!id) {
    const [ins] = await pool.query(
      'INSERT INTO saxo_automation_orders (user_id, strategy_id, instrument_id, signal_date, signal_side, reason) VALUES (?, ?, ?, ?, ?, ?)', [...unique, s.reason],
    );
    id = ins.insertId;
  }
  const finish = async (outcome, message = null, orderId = null) => {
    await pool.query('UPDATE saxo_automation_orders SET outcome = ?, message = ?, order_id = ? WHERE id = ?', [outcome, message?.slice(0, 500) ?? null, orderId, id]);
    return outcome;
  };

  let params;
  if (s.side === 'sell') {
    const own = await strategyHolding(pool, userId, strategy.id, s.instrumentId);
    if (own <= 0) return finish('skipped', 'sem posição comprada pela automação nesta estratégia');
    const held = await getHeld(s.instrumentId);
    const quantity = Math.min(own, held);
    if (quantity <= 0) return finish('skipped', 'a conta SAXO já não tem esta posição');
    params = { side: 'sell', quantity, orderType: 'market' };
  } else {
    const quantity = buyQuantity(strategy.budget, s.lastClose);
    if (quantity < 1) return finish('skipped', `o orçamento da estratégia não chega para uma unidade a ${s.lastClose}`);
    const known = await storedResolution(pool, s.instrumentId, session.environment);
    params = { side: 'buy', quantity, orderType: 'limit', limitPrice: buyLimit(s.lastClose, known ? parseScheme(known) : null) };
  }

  const key = signalKey(s, strategy.id);
  const order = { ...params, instrumentId: s.instrumentId, idempotencyKey: key, automated: true };
  try {
    let res;
    try {
      res = await placeOrder(pool, cfg, session, order, { wait });
    } catch (err) {
      // Correspondência sem passo de preço guardado: o limite só se acerta depois de a API o conhecer.
      if (err.code !== 'SAXO_TICK_SIZE' || !err.details?.suggested) throw err;
      res = await placeOrder(pool, cfg, session, { ...order, limitPrice: err.details.suggested }, { wait });
    }
    return finish('sent', null, res.order.id);
  } catch (err) {
    const [[o]] = await pool.query('SELECT id FROM saxo_orders WHERE user_id = ? AND idempotency_key = ?', [userId, key]);
    // Recusada pela SAXO ou sem resposta: a ordem ficou registada com esse estado e não se repete.
    if (o) return finish('sent', err.message, o.id);
    // Nada foi enviado. Ligação ou falha temporária: o sinal fica por tratar e a execução repete-se daqui a 5 min.
    if (FATAL.has(err.code) || err.status === 429 || err.status >= 500) throw err;
    return finish('failed', err.message);
  }
}

/** Execução de um utilizador: refresca as ordens, lê os sinais das estratégias ligadas e envia. */
export async function runForUser(pool, cfg, userId, clock, { lastFinal, loadSignals, log = null }) {
  const session = await openSession(pool, cfg, userId);
  if (session.environment !== 'sim') throw Object.assign(new Error('a automação só funciona na conta de simulação da SAXO Bank'), { code: 'SAXO_LIVE_BLOCKED' });
  await pickAccount(session.client);
  await listOrders(pool, session, { limit: 1 }); // estado actual, para as vendas verem as compras executadas
  const [rows] = await pool.query('SELECT strategy_id FROM saxo_automation_strategies WHERE user_id = ? AND enabled = 1', [userId]);
  const wait = createThrottle(() => cfg.saxo.orderSpacingMs);
  let held = null;
  const getHeld = async (instrumentId) => {
    if (!held) {
      held = new Map();
      for (const p of (await getPortfolio(pool, session)).positions) {
        if (p.instrumentId != null) held.set(p.instrumentId, (held.get(p.instrumentId) ?? 0) + Number(p.quantity));
      }
    }
    return held.get(instrumentId) ?? 0;
  };
  const counts = {};
  for (const { strategy_id: id } of rows) {
    const strategy = getStrategy(id);
    if (!strategy?.available) continue;
    const items = selectSignals(await loadSignals(strategy), { lastFinal, today: clock.date });
    for (const s of items) {
      const outcome = await handleSignal(pool, cfg, session, s, strategy, { getHeld, wait });
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    }
  }
  log?.info?.({ userId, counts }, 'saxo: automação concluída');
  return counts;
}

let running = false;

/**
 * Chamada pela vigia da SAXO a cada minuto: 10 minutos depois de cada recolha horária, corre os utilizadores com a automação
 * ligada que ainda não correram nessa hora. Precisa da recolha dessa hora (senão os sinais não são os últimos) e da recolha
 * diária da última sessão.
 */
export async function runDueAutomation(pool, cfg, { now = new Date(), loadSignals = null, log = null } = {}) {
  const clock = lisbonClock(now);
  const hour = runSlot(clock);
  if (hour == null || running) return 0;
  const [due] = await pool.query(
    `SELECT s.user_id, r.status, r.finished_at, r.started_at
       FROM saxo_automation_settings s
       LEFT JOIN saxo_automation_runs r ON r.user_id = s.user_id AND r.run_date = ? AND r.run_hour = ?
      WHERE s.enabled = 1 AND (r.status IS NULL OR r.status <> 'done')
        AND EXISTS (SELECT 1 FROM saxo_automation_strategies x WHERE x.user_id = s.user_id AND x.enabled = 1)`, [clock.date, hour],
  );
  const ready = due.filter((r) => !r.status
    || (r.status === 'failed' && now - new Date(r.finished_at) >= RETRY_MS)
    || (r.status === 'running' && now - new Date(r.started_at) >= STUCK_MS));
  if (!ready.length) return 0;
  running = true;
  try {
    const [[intraday]] = await pool.query("SELECT MAX(started_at) AS at FROM job_runs WHERE kind = 'fetch_intraday' AND status = 'done'");
    const last = intraday?.at ? lisbonClock(new Date(intraday.at)) : null;
    const fresh = last?.date === clock.date && Number(last.time.slice(0, 2)) === hour;
    if (!fresh && Number(clock.time.slice(3)) < LATE_MINUTE) return 0; // a recolha pode ainda estar a acabar
    const { lastFinal, confirmed } = await lastFinalSession(pool, clock.date);
    const cache = new Map();
    const signals = loadSignals ?? (async (strategy) => {
      if (!cache.has(strategy.id)) cache.set(strategy.id, buildItems({ data: await computeAll(pool, strategy) }, 3, strategy.id).items);
      return cache.get(strategy.id);
    });
    let done = 0;
    for (const { user_id: userId } of ready) {
      await pool.query(
        `INSERT INTO saxo_automation_runs (user_id, run_date, run_hour) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE status = 'running', started_at = NOW(3), finished_at = NULL, detail = NULL`, [userId, clock.date, hour],
      );
      const key = [userId, clock.date, hour];
      try {
        if (!fresh) throw new Error('a recolha horária do Yahoo não terminou: esta hora fica sem execução');
        if (!confirmed) throw new Error('a recolha diária da última sessão não terminou: os sinais ainda não são firmes');
        const counts = await runForUser(pool, cfg, userId, clock, { lastFinal, loadSignals: signals, log });
        await pool.query("UPDATE saxo_automation_runs SET status = 'done', counts = ?, finished_at = NOW(3) WHERE user_id = ? AND run_date = ? AND run_hour = ?", [JSON.stringify(counts), ...key]);
        done += 1;
      } catch (err) {
        await pool.query("UPDATE saxo_automation_runs SET status = 'failed', detail = ?, finished_at = NOW(3) WHERE user_id = ? AND run_date = ? AND run_hour = ?", [String(err.message).slice(0, 500), ...key]);
        log?.warn?.({ userId, err: err.message }, 'saxo: automação não correu');
      }
    }
    return done;
  } finally {
    running = false;
  }
}

/** Estado da automação de um utilizador: interruptor geral, um por estratégia e a última execução. */
export async function automationStatus(pool, userId) {
  const [[s]] = await pool.query('SELECT enabled FROM saxo_automation_settings WHERE user_id = ?', [userId]);
  const [rows] = await pool.query('SELECT strategy_id, enabled FROM saxo_automation_strategies WHERE user_id = ?', [userId]);
  const on = new Set(rows.filter((r) => r.enabled).map((r) => r.strategy_id));
  const [[run]] = await pool.query('SELECT run_date, status, counts, detail, started_at, finished_at FROM saxo_automation_runs WHERE user_id = ? ORDER BY run_date DESC, run_hour DESC LIMIT 1', [userId]);
  let counts = {};
  try { counts = run?.counts ? JSON.parse(run.counts) : {}; } catch { counts = {}; }
  return {
    enabled: Boolean(s?.enabled),
    strategies: AVAILABLE_STRATEGIES.map((x) => ({ id: x.id, name: x.name, summary: x.summary, budget: x.budget, enabled: on.has(x.id) })),
    lastRun: run ? { date: run.run_date, status: run.status, counts, detail: run.detail, startedAt: run.started_at.toISOString(), finishedAt: run.finished_at?.toISOString() ?? null } : null,
  };
}

export async function setAutomationEnabled(pool, userId, enabled) {
  await pool.query('INSERT INTO saxo_automation_settings (user_id, enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)', [userId, enabled ? 1 : 0]);
  await audit(pool, userId, 'saxo.automation_toggle', 'user', userId, { enabled });
}

export async function setAutomationStrategy(pool, userId, strategyId, enabled) {
  await pool.query(
    'INSERT INTO saxo_automation_strategies (user_id, strategy_id, enabled) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)',
    [userId, strategyId, enabled ? 1 : 0],
  );
  await audit(pool, userId, 'saxo.automation_strategy_toggle', 'user', userId, { strategy: strategyId, enabled });
}

/** Sinais tratados pela automação (os mais recentes primeiro), com o estado real da ordem na SAXO. */
export async function automationOrders(pool, userId, { limit = 100 } = {}) {
  const [rows] = await pool.query(
    `SELECT a.id, a.strategy_id, a.signal_date, a.signal_side, a.reason, a.outcome, a.message, a.created_at,
            i.id AS instrument_id, i.symbol, i.name,
            o.id AS order_id, o.saxo_order_id, o.side, o.quantity, o.order_type, o.limit_price, o.status, o.filled_quantity, o.fill_price, o.message AS order_message
       FROM saxo_automation_orders a
       JOIN instruments i ON i.id = a.instrument_id
       LEFT JOIN saxo_orders o ON o.id = a.order_id
      WHERE a.user_id = ? AND a.outcome <> 'pending'
      ORDER BY a.created_at DESC, a.id DESC LIMIT ?`, [userId, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id), strategy: r.strategy_id, strategyName: getStrategy(r.strategy_id)?.name ?? r.strategy_id,
    signalDate: r.signal_date, signalSide: r.signal_side, reason: r.reason, outcome: r.outcome, message: r.message ?? r.order_message ?? null,
    createdAt: r.created_at.toISOString(), instrumentId: Number(r.instrument_id), symbol: r.symbol, name: r.name,
    order: r.order_id == null ? null : {
      id: Number(r.order_id), saxoOrderId: r.saxo_order_id, side: r.side, quantity: Number(r.quantity), orderType: r.order_type,
      limitPrice: r.limit_price, status: r.status, filledQuantity: r.filled_quantity == null ? null : Number(r.filled_quantity), fillPrice: r.fill_price,
    },
  }));
}
