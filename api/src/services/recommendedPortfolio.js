import { monthsBefore, prepareInstrument, simulate } from '../../../shared/strategies/portfolio.js';

const CACHE_MS = 10 * 60_000; // as cotações fechadas só mudam com a recolha
export const WINDOW_MONTHS = 24;

const stores = new WeakMap();

/**
 * Portfolio Recomendado (shared/strategies/portfolio.js) sobre o catálogo: carteira-modelo de 20 instrumentos, revista de duas em
 * duas semanas. A simulação corre desde o início do histórico (para a janela de 24 meses medir uma carteira já em andamento) e só
 * usa sessões fechadas (sem as cotações provisórias da sessão em curso), para as listas não mudarem a meio do dia.
 *
 * Lê as cotações um instrumento de cada vez e guarda só as séries de que o motor precisa; o resultado é igual para todos os
 * utilizadores e fica em cache (10 minutos; depois disso responde com o que tem e recalcula em segundo plano).
 */
export function recommendedPortfolioService(pool) {
  const cacheable = pool != null && typeof pool === 'object'; // (testes que montam a API sem base de dados)
  let store = cacheable ? stores.get(pool) : null;
  if (store) return store;
  let cached = null; // { at, result }
  let loading = null;

  /** Com resultado em cache responde logo; se já tem mais de 10 minutos, recalcula em segundo plano (como as outras análises). */
  async function run() {
    if (cached) {
      if (Date.now() - cached.at >= CACHE_MS) refresh().catch(() => {});
      return cached.result;
    }
    return refresh();
  }

  function refresh() {
    loading ??= (async () => {
      const [insts] = await pool.query(
        `SELECT i.id, i.symbol, i.name, p.sector
           FROM instruments i LEFT JOIN company_profiles p ON p.instrument_id = i.id
          WHERE i.status = 'active' AND i.last_session IS NOT NULL ORDER BY i.id`,
      );
      const universe = [];
      for (const inst of insts) {
        const [quotes] = await pool.query(
          `SELECT session_date AS date, open, high, low, close, adj_close AS adjClose, volume
             FROM daily_quotes WHERE instrument_id = ? AND NOT provisional ORDER BY session_date`,
          [inst.id],
        );
        const u = prepareInstrument({ id: Number(inst.id), symbol: inst.symbol, name: inst.name, sector: inst.sector ?? null }, quotes);
        if (u.dates.length) universe.push(u);
      }
      const last = universe.map((u) => u.dates.at(-1)).sort().at(-1) ?? null;
      const result = last
        ? { ...simulate(universe, { from: monthsBefore(last, WINDOW_MONTHS), to: last }), universe: universe.length, latestSession: last }
        : null;
      cached = { at: Date.now(), result };
      return result;
    })().finally(() => { loading = null; });
    return loading;
  }

  store = { run, refresh };
  if (cacheable) stores.set(pool, store);
  return store;
}
