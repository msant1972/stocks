import { yearsBefore } from '../dates.js';
import { PERIODS } from '../../../shared/strategies/index.js';
import { DEFAULT_OPTIONS, prepareInstrument, simulate } from '../../../shared/strategies/rotacao.js';

const CACHE_MS = 10 * 60_000; // as cotações só mudam com a recolha
const WINDOW_YEARS = 2;
const HISTORY_YEARS = 3 + 2; // aquecimento de 12 meses antes da janela, mais o período de verificação (2 anos)

const stores = new WeakMap();

/**
 * Rotação por momentum relativo (shared/strategies/rotacao.js) sobre o catálogo. Carrega as cotações de todos os instrumentos
 * activos de uma vez (uma consulta ordenada, só as colunas necessárias, numa estrutura compacta) e guarda-as 10 minutos; o
 * resultado de cada combinação (período, nº de posições, universo) também fica em cache.
 */
export function rotationService(pool) {
  const cacheable = pool != null && typeof pool === 'object'; // (testes que montam a API sem base de dados)
  let store = cacheable ? stores.get(pool) : null;
  if (store) return store;
  let data = null; // { at, instruments: [{ id, symbol, name, quotes }], last }
  let loading = null;
  const results = new Map();

  async function load() {
    if (data && Date.now() - data.at < CACHE_MS) return data;
    loading ??= (async () => {
      const [insts] = await pool.query(
        "SELECT id, symbol, name, last_session FROM instruments WHERE status = 'active' AND last_session IS NOT NULL ORDER BY id",
      );
      const last = insts.map((i) => i.last_session).sort().at(-1) ?? null;
      const byId = new Map(insts.map((i) => [Number(i.id), { id: Number(i.id), symbol: i.symbol, name: i.name, quotes: [] }]));
      if (last) {
        const [rows] = await pool.query(
          `SELECT q.instrument_id, q.session_date AS date, q.open, q.close, q.adj_close AS adjClose, q.volume
             FROM daily_quotes q JOIN instruments i ON i.id = q.instrument_id
            WHERE i.status = 'active' AND q.session_date >= ? ORDER BY q.instrument_id, q.session_date`,
          [yearsBefore(last, HISTORY_YEARS)],
        );
        for (const r of rows) byId.get(Number(r.instrument_id))?.quotes.push({ date: r.date, open: r.open, close: r.close, adjClose: r.adjClose, volume: r.volume });
      }
      results.clear();
      data = { at: Date.now(), instruments: [...byId.values()].filter((i) => i.quotes.length), last };
      return data;
    })().finally(() => { loading = null; });
    return loading;
  }

  /** period: 'recent' ou 'verification'; positions: nº de posições; ids: restringe o universo (null = todo o catálogo). */
  async function run({ period = 'recent', positions = DEFAULT_OPTIONS.positions, ids = null, key = 'all' } = {}) {
    const d = await load();
    if (!d.last) return null;
    const cacheKey = `${period}|${positions}|${key}`;
    const hit = results.get(cacheKey);
    if (hit) return hit;
    const to = yearsBefore(d.last, PERIODS[period] ?? 0);
    const from = yearsBefore(to, WINDOW_YEARS);
    const opt = { positions, keepRank: positions * 2 };
    const o = { ...DEFAULT_OPTIONS, ...opt };
    const universe = d.instruments
      .filter((i) => !ids || ids.has(i.id))
      .map((i) => prepareInstrument({ id: i.id, symbol: i.symbol, name: i.name }, i.quotes.filter((q) => q.date <= to), o))
      .filter((i) => i.dates.length);
    const result = { ...simulate(universe, { from, to, ...opt }), period, universe: universe.length, latestSession: d.last };
    results.set(cacheKey, result);
    return result;
  }

  store = { run, load };
  if (cacheable) stores.set(pool, store);
  return store;
}
