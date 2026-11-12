import fs from 'node:fs';
import path from 'node:path';
import { computeStrategiesParallel } from './strategyRuns.js';

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_MAX_AGE_MS = 7 * 86_400_000;

/**
 * Lê os resultados gravados pela execução anterior. Entram como antigos (at = 0): servem de imediato e o primeiro pedido
 * (ou o cálculo antecipado) recalcula-os, para não ficarem resultados de uma versão anterior das estratégias.
 */
export function loadSnapshot(file, log) {
  const cache = new Map();
  if (!file) return cache;
  try {
    const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (snap?.version !== SNAPSHOT_VERSION || !(Date.now() - snap.savedAt < SNAPSHOT_MAX_AGE_MS)) return cache;
    for (const [k, items] of Object.entries(snap.entries ?? {})) if (Array.isArray(items)) cache.set(k, { at: 0, items });
  } catch (err) {
    if (err.code !== 'ENOENT') log?.warn?.({ err }, 'estratégias: resultados gravados ilegíveis');
  }
  return cache;
}

/** Grava os resultados (ficheiro temporário e rename, para nunca ficar meio escrito). */
export async function saveSnapshot(file, cache, log) {
  if (!file) return;
  const entries = Object.fromEntries([...cache].map(([k, e]) => [k, e.items]));
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(tmp, JSON.stringify({ version: SNAPSHOT_VERSION, savedAt: Date.now(), entries }));
    await fs.promises.rename(tmp, file);
  } catch (err) {
    log?.warn?.({ err }, 'estratégias: não foi possível gravar os resultados');
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
  }
}

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
  // Por estratégia e período; começa com os resultados gravados pela execução anterior (se houver).
  const cache = loadSnapshot(cfg?.strategyCacheFile, log);
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
        await saveSnapshot(cfg?.strategyCacheFile, cache, log);
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
