import { computeStrategiesParallel } from './strategyRuns.js';

const CACHE_MS = 10 * 60_000; // as cotações só mudam com a recolha diária
const VERIFICATION_CACHE_MS = 6 * 3600_000; // período de verificação: dados antigos, só a data de fim avança

const stores = new WeakMap();

/**
 * Resultados do BackTest de cada estratégia em todos os instrumentos, em cache e partilhados por tudo o que os usa (rotas do
 * BackTest, Comparar, WinnersLoosers, Acompanhar e a Automação): um só armazém por ligação à base de dados. As desactualizadas
 * (mais de 10 minutos) ou em falta são calculadas numa só passagem pelo catálogo, em worker threads, e os cálculos são
 * serializados (sem cálculos em paralelo, por causa da memória).
 */
export function strategyResults(pool, cfg, log = null) {
  const cacheable = pool != null && typeof pool === 'object'; // (testes que montam a API sem base de dados: sem armazém partilhado)
  let store = cacheable ? stores.get(pool) : null;
  if (store) return store;
  const cache = new Map(); // por estratégia e período
  let running = Promise.resolve();
  const key = (st, period) => (period === 'recent' ? st.id : `${period}:${st.id}`);
  const fresh = (st, period = 'recent') => {
    const e = cache.get(key(st, period));
    return e && Date.now() - e.at <= (period === 'recent' ? CACHE_MS : VERIFICATION_CACHE_MS);
  };
  /** force recalcula mesmo as recentes. */
  function recompute(strategies, force = false, period = 'recent') {
    const job = running.then(async () => {
      const missing = force ? strategies : strategies.filter((st) => !fresh(st, period));
      if (missing.length) {
        const at = Date.now();
        const computed = await computeStrategiesParallel(pool, cfg.db, missing, log, period);
        for (const st of missing) cache.set(key(st, period), { at, items: computed.get(st.id) });
      }
      return strategies.map((st) => cache.get(key(st, period)));
    });
    running = job.catch(() => {});
    return job;
  }
  /**
   * Stale-while-revalidate: com resultados em cache (mesmo antigos) responde de imediato e recalcula em segundo plano; só
   * espera quando ainda não há nenhum (primeiro pedido, se o cálculo antecipado não terminou).
   */
  function ensure(strategies, period = 'recent') {
    if (strategies.every((st) => cache.has(key(st, period)))) {
      if (!strategies.every((st) => fresh(st, period))) {
        recompute(strategies, false, period).catch((err) => log?.warn?.({ err }, 'estratégias: recálculo falhou'));
      }
      return Promise.resolve(strategies.map((st) => cache.get(key(st, period))));
    }
    return recompute(strategies, false, period);
  }
  store = { ensure, recompute };
  if (cacheable) stores.set(pool, store);
  return store;
}

/**
 * Melhor estratégia de cada instrumento: a de maior resultado no BackTest, entre as estratégias dadas (as ligadas).
 * strategies e computed (uma entrada por estratégia, com `items`) vêm pela mesma ordem. Devolve Map(instrumentId → { strategyId,
 * total, totalPct }); o resultado pode ser negativo (nenhuma estratégia ganha).
 */
export function bestByInstrument(strategies, computed) {
  const best = new Map();
  strategies.forEach((st, k) => {
    for (const it of computed[k].items) {
      const cur = best.get(it.instrumentId);
      if (!cur || it.total > cur.total) best.set(it.instrumentId, { instrumentId: it.instrumentId, strategyId: st.id, total: it.total, totalPct: it.totalPct });
    }
  });
  return best;
}
