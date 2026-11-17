import { effectiveMap } from '../../../shared/strategies/choice.js';
import { enabledStrategies } from './strategySettings.js';
import { bestByInstrument, strategyResults } from './strategyResults.js';

/** Escolhas do utilizador: Map(instrumentId → strategyId | null), null = «Nenhuma». */
export async function loadChoices(pool, userId) {
  const [rows] = await pool.query('SELECT instrument_id, strategy_id FROM instrument_strategy_choices WHERE user_id = ?', [userId]);
  return new Map(rows.map((r) => [Number(r.instrument_id), r.strategy_id ?? null]));
}

/**
 * Estratégia efectiva de cada instrumento dado (shared/strategies/choice.js): a escolhida no Charts ou, sem escolha, a melhor
 * ligada (resultados do BackTest em cache, partilhados com as rotas). Map(instrumentId → strategyId | null).
 */
export async function effectiveStrategies(pool, cfg, userId, ids, log = null) {
  if (!ids.size) return new Map();
  const choices = await loadChoices(pool, userId);
  const on = await enabledStrategies(pool);
  const enabled = new Set(on.map((s) => s.id));
  // Os resultados do BackTest só são precisos para os instrumentos sem escolha.
  const needBest = [...ids].some((id) => !choices.has(id) || (choices.get(id) !== null && !enabled.has(choices.get(id))));
  const best = needBest ? bestByInstrument(on, await strategyResults(pool, cfg, log).ensure(on)) : new Map();
  return effectiveMap(ids, { choices, best, isEnabled: (id) => enabled.has(id) });
}
