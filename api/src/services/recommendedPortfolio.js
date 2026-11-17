import { monthsBefore, prepareInstrument, simulate } from '../../../shared/strategies/portfolio.js';
import { SESSIONS_NEEDED } from '../../../shared/promessas.js';

const STARTS_CACHED = 20; // resultados por data de início guardados (os mais recentes)

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
  let cached = null; // { at, result, universe, minStart }
  let loading = null;
  const byStart = new Map(); // data de início → resultado (limpo a cada recálculo)

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
      // Primeira data de início útil: quando já há 20 instrumentos com o histórico que a pontuação precisa (316 sessões).
      const ready = universe.filter((u) => u.dates.length >= SESSIONS_NEEDED).map((u) => u.dates[SESSIONS_NEEDED - 1]).sort();
      const minStart = ready.length >= 20 ? ready[19] : null;
      const result = last
        ? { ...simulate(universe, { from: monthsBefore(last, WINDOW_MONTHS), to: last }), universe: universe.length, latestSession: last, start: null, minStart }
        : null;
      cached = { at: Date.now(), result, universe, minStart };
      byStart.clear();
      return result;
    })().finally(() => { loading = null; });
    return loading;
  }

  /**
   * Carteira fixa com data de início: começa vazia na primeira sessão a partir de `start`, compra os 20 melhores com os sinais desse
   * dia e mantém-nos até à última sessão, sem revisões; é medida daí até hoje (em vez dos últimos 24 meses). `start` tem de estar entre minStart e a última sessão (a rota valida).
   */
  async function runFrom(start) {
    const base = await run();
    if (!base) return null;
    const hit = byStart.get(start);
    if (hit) return hit;
    const { universe } = cached;
    const result = {
      ...simulate(universe, { start, from: start, to: base.latestSession, reviewAtStart: true, rebalance: false }),
      universe: universe.length, latestSession: base.latestSession, start, minStart: base.minStart,
    };
    byStart.set(start, result);
    if (byStart.size > STARTS_CACHED) byStart.delete(byStart.keys().next().value);
    return result;
  }

  /** Limites da data de início: { minStart, latestSession }. */
  async function limits() {
    const base = await run();
    return { minStart: base?.minStart ?? null, latestSession: base?.latestSession ?? null };
  }

  store = { run, runFrom, limits, refresh };
  if (cacheable) stores.set(pool, store);
  return store;
}
