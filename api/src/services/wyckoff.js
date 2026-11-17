import { PHASES, phase, sessionsNeeded } from '../../../shared/wyckoff.js';

const CACHE_MS = 10 * 60_000; // as cotações fechadas só mudam com a recolha
const SESSIONS = sessionsNeeded() + 20; // folga para sessões inválidas

const stores = new WeakMap();

/**
 * Fase de Wyckoff de cada instrumento activo (shared/wyckoff.js), na última sessão fechada (sem as cotações provisórias da
 * sessão em curso, para a etiqueta não mudar a meio do dia). Lê as últimas sessões de um instrumento de cada vez; o resultado é
 * igual para todos os utilizadores e fica em cache (10 minutos; depois responde com o que tem e recalcula em segundo plano).
 */
export function wyckoffService(pool) {
  const cacheable = pool != null && typeof pool === 'object'; // (testes que montam a API sem base de dados)
  let store = cacheable ? stores.get(pool) : null;
  if (store) return store;
  let cached = null; // { at, result }
  let loading = null;

  async function run() {
    if (cached) {
      if (Date.now() - cached.at >= CACHE_MS) refresh().catch(() => {});
      return cached.result;
    }
    return refresh();
  }

  function refresh() {
    loading ??= (async () => {
      const [insts] = await pool.query("SELECT id FROM instruments WHERE status = 'active' AND last_session IS NOT NULL ORDER BY id");
      const items = [];
      const counts = Object.fromEntries(PHASES.map((p) => [p, 0]));
      let latestSession = null;
      for (const inst of insts) {
        const [rows] = await pool.query(
          `SELECT session_date AS date, open, high, low, close, adj_close AS adjClose, volume
             FROM daily_quotes WHERE instrument_id = ? AND NOT provisional ORDER BY session_date DESC LIMIT ?`,
          [inst.id, SESSIONS],
        );
        const p = phase(rows.reverse());
        if (!p) continue;
        if (!latestSession || p.date > latestSession) latestSession = p.date;
        counts[p.phase] += 1;
        items.push({
          instrumentId: Number(inst.id), phase: p.phase, date: p.date, lateral: p.lateral, position: p.position, width: p.width,
          support: p.support, resistance: p.resistance, rangeSessions: p.rangeSessions, volumeBias: p.volumeBias,
        });
      }
      const result = { computedAt: new Date().toISOString(), latestSession, counts, items };
      cached = { at: Date.now(), result };
      return result;
    })().finally(() => { loading = null; });
    return loading;
  }

  store = { run, refresh };
  if (cacheable) stores.set(pool, store);
  return store;
}
