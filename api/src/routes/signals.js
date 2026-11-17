import { z } from 'zod';
import { AVAILABLE_STRATEGIES, getStrategy } from '../../../shared/strategies/index.js';
import { assertEnabled, defaultStrategyId, enabledStrategies } from '../services/strategySettings.js';
import { IsoDate } from '../schemas.js';
import { buildItems, computeAll, MAX_SESSIONS } from '../services/signals.js';
import { effectiveStrategies } from '../services/strategyChoices.js';

const CACHE_MS = 10 * 60_000; // as cotações só mudam com a recolha diária

const Signal = z.object({
  instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(),
  side: z.enum(['buy', 'add', 'sell']),
  reason: z.string().nullable().describe('Motivo da venda (ex.: stop, trend_break), quando a estratégia o indica'),
  date: IsoDate, sessionsAgo: z.number(),
  price: z.string().describe('Preço real da operação simulada (fecho na A-Momentum; abertura ou stop na B-Opus)'),
  lastClose: z.string(), lastDate: IsoDate,
  changeSincePct: z.string().describe('Variação do fecho real desde o sinal, em %'),
  momentumPct: z.string().nullable().describe('SMA10/SMA200 − 1 na última sessão, em %'),
});

export default async function signalRoutes(app, { pool, cfg, warmup = () => {} }) {
  const cache = new Map(); // por estratégia
  let running = Promise.resolve();
  const fresh = (e) => e && Date.now() - e.at <= CACHE_MS;

  /** Recalcula a estratégia (serializado: um cálculo de cada vez, por causa da memória). force recalcula mesmo se recente. */
  function recompute(strategy, force = false) {
    const job = running.then(async () => {
      let e = cache.get(strategy.id);
      if (force || !fresh(e)) {
        e = { at: Date.now(), data: await computeAll(pool, strategy) };
        cache.set(strategy.id, e);
      }
      return e;
    });
    running = job.catch(() => {});
    return job;
  }
  /** Stale-while-revalidate: com resultado em cache (mesmo antigo) responde logo e recalcula em segundo plano. */
  function entryFor(strategy) {
    const e = cache.get(strategy.id);
    if (e) {
      if (!fresh(e)) recompute(strategy).catch((err) => app.log.warn({ err }, 'sinais: recálculo falhou'));
      return Promise.resolve(e);
    }
    return recompute(strategy);
  }
  for (const st of AVAILABLE_STRATEGIES) warmup(() => recompute(st, true));

  const SignalWithStrategy = Signal.extend({ strategy: z.string() });
  async function watchlistIds(userId) {
    const [w] = await pool.query('SELECT instrument_id FROM watchlist_items WHERE user_id = ?', [userId]);
    return new Set(w.map((r) => Number(r.instrument_id)));
  }
  const sessionsQuery = z.coerce.number().int().min(1).max(MAX_SESSIONS).default(5);
  const onlyQuery = z.enum(['chosen', 'all']).describe('chosen: só os instrumentos cuja estratégia (a escolhida no Charts ou, sem escolha, a melhor ligada) é a do sinal; all: todos');
  /** Estratégia de cada instrumento da lista (escolhida ou a melhor), para o filtro `only=chosen` e a marca `chosen`. */
  const strategyOf = (req, ids) => effectiveStrategies(pool, cfg, req.user.id, ids, app.log);

  app.get('/signals', {
    schema: {
      tags: ['Sinais'], summary: 'Sinais de uma estratégia nos instrumentos da minha lista ou em todo o catálogo (últimas N sessões)',
      description: 'Estratégias: ' + AVAILABLE_STRATEGIES.map((x) => `${x.id} (${x.name}: ${x.rules})`).join(' ')
        + ' Simulação; não são recomendações.',
      querystring: z.object({
        sessions: sessionsQuery,
        strategy: z.enum(AVAILABLE_STRATEGIES.map((s) => s.id)).optional().describe('Por omissão, a A-Momentum ou a primeira ligada'),
        scope: z.enum(['all', 'watchlist']).default('all').describe('watchlist: só os instrumentos da minha lista (página Sinais)'),
        only: onlyQuery.default('all'),
      }),
      response: {
        200: z.object({
          strategy: z.string(), sessions: z.number(), scope: z.enum(['all', 'watchlist']),
          instruments: z.number().nullable().describe('Instrumentos da minha lista (scope=watchlist); null em todo o catálogo'),
          only: z.enum(['chosen', 'all']), hidden: z.number().describe('Sinais escondidos pelo filtro `only=chosen`'),
          latestSession: IsoDate.nullable(), items: z.array(Signal.extend({ chosen: z.boolean().nullable().describe('A estratégia do sinal é a deste instrumento: a escolhida no Charts ou, sem escolha, a melhor ligada') })),
        }),
      },
    },
  }, async (req) => {
    const on = await enabledStrategies(pool);
    const strategy = getStrategy(req.query.strategy ?? defaultStrategyId(on));
    await assertEnabled(pool, strategy.id);
    const mine = req.query.scope === 'watchlist' ? await watchlistIds(req.user.id) : null;
    const { items, latestSession } = buildItems(await entryFor(strategy), req.query.sessions, strategy.id, mine);
    // Marca (e, com only=chosen, filtra) os sinais cuja estratégia é a do instrumento.
    const ids = mine ?? new Set(items.map((i) => i.instrumentId));
    const own = await strategyOf(req, ids);
    const marked = items.map((i) => ({ ...i, chosen: own.has(i.instrumentId) ? own.get(i.instrumentId) === strategy.id : null }));
    const kept = req.query.only === 'chosen' ? marked.filter((i) => i.chosen) : marked;
    return {
      strategy: strategy.id, sessions: req.query.sessions, scope: req.query.scope, only: req.query.only, hidden: marked.length - kept.length,
      instruments: mine ? mine.size : null, latestSession, items: kept,
    };
  });

  app.get('/signals/watchlist', {
    schema: {
      tags: ['Sinais'], summary: 'Sinais de todas as estratégias nos instrumentos da minha lista (últimas N sessões)',
      description: 'Junta os sinais das estratégias disponíveis, só nos instrumentos da lista de acompanhamento do utilizador; por omissão '
        + '(only=chosen) só os da estratégia de cada instrumento (a escolhida no Charts ou, sem escolha, a melhor ligada). '
        + 'Usa as mesmas caches dos Sinais. Simulação; não são recomendações.',
      querystring: z.object({ sessions: sessionsQuery.default(1), only: onlyQuery.default('chosen') }),
      response: { 200: z.object({ sessions: z.number(), only: z.enum(['chosen', 'all']), hidden: z.number(), latestSession: IsoDate.nullable(), items: z.array(SignalWithStrategy) }) },
    },
  }, async (req) => {
    const mine = await watchlistIds(req.user.id);
    const items = [];
    let latestSession = null;
    for (const st of await enabledStrategies(pool)) {
      const r = buildItems(await entryFor(st), req.query.sessions, st.id, mine);
      items.push(...r.items);
      if (r.latestSession && (!latestSession || r.latestSession > latestSession)) latestSession = r.latestSession;
    }
    items.sort((a, b) => (a.date === b.date ? a.symbol.localeCompare(b.symbol) : b.date.localeCompare(a.date)));
    if (req.query.only === 'all') return { sessions: req.query.sessions, only: 'all', hidden: 0, latestSession, items };
    const own = await strategyOf(req, mine);
    const kept = items.filter((i) => own.get(i.instrumentId) === i.strategy);
    return { sessions: req.query.sessions, only: 'chosen', hidden: items.length - kept.length, latestSession, items: kept };
  });
}
