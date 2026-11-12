import { AVAILABLE_STRATEGIES, DEFAULT_STRATEGY_ID } from '../../../shared/strategies/index.js';
import { audit, withTransaction } from '../db.js';
import { AppError } from '../errors.js';

/**
 * Estratégias ligadas (Definições → Estratégias). Só as ligadas entram nos resultados de todos os módulos (Acompanhar,
 * Sinais, BackTest, Comparar, WinnersLoosers, Charts, Visão geral) e na Automação. Sem linha na tabela = ligada. Há sempre
 * pelo menos uma ligada.
 */
export async function enabledStrategies(pool) {
  const [rows] = await pool.query('SELECT strategy_id FROM strategy_settings WHERE enabled = 0');
  const off = new Set(rows.map((r) => r.strategy_id));
  const on = AVAILABLE_STRATEGIES.filter((s) => !off.has(s.id));
  return on.length ? on : [AVAILABLE_STRATEGIES[0]]; // nunca vazio, mesmo com a tabela alterada à mão
}

/** Estratégia por omissão: a A-Momentum, ou a primeira ligada quando ela está desligada. */
export const defaultStrategyId = (enabled) => (enabled.some((s) => s.id === DEFAULT_STRATEGY_ID) ? DEFAULT_STRATEGY_ID : enabled[0].id);

/** 409 se a estratégia está desligada. */
export async function assertEnabled(pool, strategyId) {
  if (!(await enabledStrategies(pool)).some((s) => s.id === strategyId)) {
    throw new AppError(409, 'STRATEGY_DISABLED', 'esta estratégia está desligada (Definições → Estratégias)');
  }
}

/** Liga ou desliga uma estratégia; recusa desligar a última ligada. */
export async function setStrategyEnabled(pool, userId, strategyId, enabled) {
  if (!AVAILABLE_STRATEGIES.some((s) => s.id === strategyId)) throw new AppError(404, 'NOT_FOUND', 'estratégia desconhecida');
  await withTransaction(pool, async (conn) => {
    if (!enabled) {
      const [rows] = await conn.query('SELECT strategy_id FROM strategy_settings WHERE enabled = 0 FOR UPDATE');
      const off = new Set(rows.map((r) => r.strategy_id));
      off.add(strategyId);
      if (AVAILABLE_STRATEGIES.every((s) => off.has(s.id))) {
        throw new AppError(409, 'LAST_STRATEGY', 'tem de ficar pelo menos uma estratégia ligada');
      }
    }
    await conn.query(
      'INSERT INTO strategy_settings (strategy_id, enabled, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_by = VALUES(updated_by)',
      [strategyId, enabled ? 1 : 0, userId],
    );
    await audit(conn, userId, 'admin.strategy_toggle', 'strategy', null, { strategy: strategyId, enabled });
  });
}
