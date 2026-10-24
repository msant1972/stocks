import { z } from 'zod';
import { AVAILABLE_STRATEGIES, DEFAULT_STRATEGY_ID, getStrategy, STRATEGIES } from '../../../shared/strategies/index.js';
import { IsoDate } from '../schemas.js';
import { yearsBefore } from './instruments.js';

const CACHE_MS = 10 * 60_000; // as cotações só mudam com a recolha diária

const Money = z.number().describe('EUR, 2 casas');
const Row = z.object({
  instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), exchange: z.string().nullable(),
  fromDate: IsoDate.nullable().describe('Primeira sessão com estado do momento conhecido'), toDate: IsoDate,
  sessions: z.number(),
  closed: z.number(), wins: z.number(), reinforcements: z.number(),
  openPosition: z.boolean(),
  peakCost: Money.describe('Capital máximo investido em simultâneo'),
  realized: Money, unrealized: Money, total: Money,
  totalPct: z.number().describe('Total sobre o capital máximo investido, em %'),
  buyHoldPnl: Money.nullable(), buyHoldPct: z.number().nullable(),
});

/**
 * Aplica estratégias do registo (shared/strategies/, as mesmas da página do instrumento) a cada instrumento
 * activo, sobre os mesmos dados que essa página carrega: os últimos windowYears anos até à última sessão do
 * instrumento, mais os warmupYears de aquecimento que cada estratégia pedir (a estratégia só actua a partir do
 * início da janela). Por isso os valores coincidem com os do gráfico.
 *
 * Processa um instrumento de cada vez (uma consulta por instrumento, com as cotações descartadas a seguir), para
 * a memória não crescer com o catálogo: carregar todas as cotações de uma vez esgotava a memória da API.
 * Devolve Map(id da estratégia → linhas).
 */
async function computeStrategies(pool, strategies) {
  const histYears = Math.max(...strategies.map((st) => st.windowYears + st.warmupYears));
  const [instruments] = await pool.query(
    "SELECT id, symbol, name, exchange, last_session FROM instruments WHERE status = 'active' AND last_session IS NOT NULL ORDER BY id",
  );
  const out = new Map(strategies.map((st) => [st.id, []]));
  for (const inst of instruments) {
    const [quotes] = await pool.query(
      `SELECT session_date AS date, open, high, low, close, adj_close AS adjClose, volume, sma10, sma125, sma200
         FROM daily_quotes WHERE instrument_id = ? AND session_date >= ? ORDER BY session_date`,
      [inst.id, yearsBefore(inst.last_session, histYears)],
    );
    for (const st of strategies) {
      const histFrom = yearsBefore(inst.last_session, st.windowYears + st.warmupYears);
      const from = yearsBefore(inst.last_session, st.windowYears);
      const q = quotes.filter((r) => r.date >= histFrom); // a mesma janela que GET /instruments/{id}/quotes?from=
      if (!q.length) continue;
      const r = st.run(q, { from });
      const s = r.summary;
      out.get(st.id).push({
        instrumentId: Number(inst.id), symbol: inst.symbol, name: inst.name, exchange: inst.exchange,
        fromDate: r.firstDate, toDate: q.at(-1).date, sessions: q.filter((x) => x.date >= from).length,
        closed: s.closed, wins: s.wins, reinforcements: s.reinforcements, openPosition: r.open != null,
        peakCost: s.peakCost, realized: s.realized, unrealized: s.unrealized, total: s.total,
        totalPct: Math.round(s.totalPct * 100) / 100,
        buyHoldPnl: s.buyHold?.pnl ?? null,
        buyHoldPct: s.buyHold ? Math.round(s.buyHold.pnlPct * 100) / 100 : null,
      });
    }
  }
  return out;
}

export default async function backtestRoutes(app, { pool }) {
  const cache = new Map(); // por estratégia

  const StrategyInfo = z.object({ id: z.string(), name: z.string(), available: z.boolean(), summary: z.string(), rules: z.string() });
  const info = ({ id, name, available, summary, rules }) => ({ id, name, available, summary, rules });

  app.get('/strategies', {
    schema: {
      tags: ['Estratégia'], summary: 'Estratégias registadas (as não disponíveis estão em preparação)',
      response: { 200: z.object({ defaultId: z.string(), items: z.array(StrategyInfo) }) },
    },
  }, async () => ({ defaultId: DEFAULT_STRATEGY_ID, items: STRATEGIES.map(info) }));

  app.get('/backtest', {
    schema: {
      tags: ['Estratégia'], summary: 'Resultado de uma estratégia em cada instrumento, nos últimos 2 anos',
      description: 'Estratégias disponíveis: ' + AVAILABLE_STRATEGIES.map((s) => `${s.id} (${s.name}: ${s.rules})`).join(' ')
        + ' Posições abertas avaliadas ao último fecho. Simulação no histórico; não altera a carteira nem é recomendação.',
      querystring: z.object({
        scope: z.enum(['all', 'watchlist']).default('all'),
        strategy: z.enum(AVAILABLE_STRATEGIES.map((s) => s.id)).default(DEFAULT_STRATEGY_ID),
      }),
      response: {
        200: z.object({
          strategy: StrategyInfo, years: z.number(), budget: z.number().nullable(), computedAt: z.string(), items: z.array(Row),
        }),
      },
    },
  }, async (req) => {
    const strategy = getStrategy(req.query.strategy);
    const entry = await results(strategy);
    let { items } = entry;
    if (req.query.scope === 'watchlist') items = await onlyWatchlist(req.user.id, items);
    return { strategy: info(strategy), years: strategy.windowYears, budget: strategy.budget, computedAt: new Date(entry.at).toISOString(), items };
  });

  // ---------- WinnersLoosers: instrumentos em que todas as estratégias ganham, ou todas perdem ----------

  const Money2 = z.number();
  app.get('/winners-losers', {
    schema: {
      tags: ['Estratégia'], summary: 'Instrumentos em que todas as estratégias disponíveis ganham, ou todas perdem (últimos 2 anos)',
      description: 'Usa os mesmos resultados do BackTest (cache de 10 minutos por estratégia). group: gain (todas com resultado '
        + 'positivo), loss (todas negativo) ou mixed. Só entram os instrumentos com resultado em todas as estratégias.',
      querystring: z.object({ scope: z.enum(['all', 'watchlist']).default('all') }),
      response: {
        200: z.object({
          strategies: z.array(z.object({ id: z.string(), name: z.string() })),
          years: z.number(), budget: z.number().nullable(), computedAt: z.string(),
          counts: z.object({ gain: z.number(), loss: z.number(), mixed: z.number(), total: z.number() }),
          items: z.array(z.object({
            instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), exchange: z.string().nullable(),
            results: z.record(z.string(), Money2).describe('Resultado de cada estratégia, por id'),
            total: Money2, buyHoldPct: z.number().nullable().describe('Comprar e manter no mesmo período, em %'),
            group: z.enum(['gain', 'loss', 'mixed']),
          })),
        }),
      },
    },
  }, async (req) => {
    const computed = await ensure(AVAILABLE_STRATEGIES);
    const entries = AVAILABLE_STRATEGIES.map((st, k) => [st, computed[k]]);
    const byId = new Map();
    for (const [st, entry] of entries) {
      for (const it of entry.items) {
        if (!byId.has(it.instrumentId)) {
          byId.set(it.instrumentId, { instrumentId: it.instrumentId, symbol: it.symbol, name: it.name, exchange: it.exchange, results: {}, buyHoldPct: it.buyHoldPct });
        }
        byId.get(it.instrumentId).results[st.id] = it.total;
      }
    }
    let items = [...byId.values()].filter((r) => AVAILABLE_STRATEGIES.every((st) => r.results[st.id] != null)).map((r) => {
      const values = AVAILABLE_STRATEGIES.map((st) => r.results[st.id]);
      const group = values.every((v) => v > 0) ? 'gain' : values.every((v) => v < 0) ? 'loss' : 'mixed';
      return { ...r, total: Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100, group };
    });
    if (req.query.scope === 'watchlist') items = await onlyWatchlist(req.user.id, items);
    items.sort((a, b) => b.total - a.total);
    const count = (g) => items.filter((i) => i.group === g).length;
    const oldest = Math.min(...entries.map(([, e]) => e.at));
    return {
      strategies: AVAILABLE_STRATEGIES.map(({ id, name }) => ({ id, name })),
      years: AVAILABLE_STRATEGIES[0].windowYears, budget: AVAILABLE_STRATEGIES[0].budget, computedAt: new Date(oldest).toISOString(),
      counts: { gain: count('gain'), loss: count('loss'), mixed: count('mixed'), total: items.length },
      items,
    };
  });

  /**
   * Resultados das estratégias em todos os instrumentos, com cache de 10 minutos. As que faltam são calculadas
   * numa só passagem pelo catálogo; pedidos simultâneos partilham o mesmo cálculo (sem cálculos em paralelo).
   */
  let running = Promise.resolve();
  function ensure(strategies) {
    const fresh = (st) => { const e = cache.get(st.id); return e && Date.now() - e.at <= CACHE_MS; };
    const job = running.then(async () => {
      const missing = strategies.filter((st) => !fresh(st));
      if (missing.length) {
        const at = Date.now();
        const computed = await computeStrategies(pool, missing);
        for (const st of missing) cache.set(st.id, { at, items: computed.get(st.id) });
      }
      return strategies.map((st) => cache.get(st.id));
    });
    running = job.catch(() => {});
    return job;
  }
  const results = async (strategy) => (await ensure([strategy]))[0];

  async function onlyWatchlist(userId, items) {
    const [w] = await pool.query('SELECT instrument_id FROM watchlist_items WHERE user_id = ?', [userId]);
    const ids = new Set(w.map((x) => Number(x.instrument_id)));
    return items.filter((i) => ids.has(i.instrumentId));
  }
}
