import { z } from 'zod';
import { AVAILABLE_STRATEGIES, DEFAULT_STRATEGY_ID, getStrategy, STRATEGIES } from '../../../shared/strategies/index.js';
import { IsoDate } from '../schemas.js';
import { yearsBefore } from './instruments.js';
import * as promessas from '../../../shared/promessas.js';

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
  investedSessions: z.number().describe('Sessões da janela com posição aberta'),
  firstYear: Money.describe('Resultado das vendas feitas no 1.º ano da janela'),
  secondYear: Money.describe('Resultado das vendas do 2.º ano e da posição aberta'),
});

/** Sessões da janela com posição e resultado de cada ano (1.º ano: vendas até mid; 2.º: o resto, com a posição aberta). */
function exposure(r, window, mid) {
  const spans = r.trades.map((t) => [t.buyDate, t.sellDate]);
  if (r.open) spans.push([r.open.buyDate, '9999-12-31']);
  const invested = window.filter((x) => spans.some(([a, z]) => x.date >= a && x.date < z)).length;
  const firstYear = Math.round(r.trades.filter((t) => t.sellDate < mid).reduce((a, t) => a + t.pnl, 0) * 100) / 100;
  return { invested, firstYear, secondYear: Math.round((r.summary.total - firstYear) * 100) / 100 };
}

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
      const window = q.filter((x) => x.date >= from);
      const e = exposure(r, window, yearsBefore(inst.last_session, st.windowYears - 1));
      out.get(st.id).push({
        instrumentId: Number(inst.id), symbol: inst.symbol, name: inst.name, exchange: inst.exchange,
        fromDate: r.firstDate, toDate: q.at(-1).date, sessions: q.filter((x) => x.date >= from).length,
        closed: s.closed, wins: s.wins, reinforcements: s.reinforcements, openPosition: r.open != null,
        peakCost: s.peakCost, realized: s.realized, unrealized: s.unrealized, total: s.total,
        totalPct: Math.round(s.totalPct * 100) / 100,
        buyHoldPnl: s.buyHold?.pnl ?? null,
        buyHoldPct: s.buyHold ? Math.round(s.buyHold.pnlPct * 100) / 100 : null,
        investedSessions: e.invested, firstYear: e.firstYear, secondYear: e.secondYear,
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

  // ---------- Comparação das estratégias (página «Comparar») ----------

  const StrategyStats = z.object({
    id: z.string(), name: z.string(),
    total: Money, gain: z.number().describe('Instrumentos com ganho'), loss: z.number().describe('Instrumentos com perda'),
    peakCost: Money.describe('Soma do capital máximo investido em cada instrumento'),
    returnOnPeakPct: z.number().describe('Resultado sobre o capital máximo investido, em %'),
    positions: z.number().describe('Operações (fechadas e abertas)'), winRate: z.number().nullable().describe('Operações fechadas com ganho, em %'),
    investedPct: z.number().nullable().describe('Tempo com posição aberta, em % das sessões'),
    worst: Money.nullable(), worst10: Money,
    firstYear: Money.nullable(), secondYear: Money.nullable(),
    bestIn: z.number().nullable().describe('Instrumentos em que é a melhor estratégia (só nas estratégias)'),
  });
  app.get('/strategies/compare', {
    schema: {
      tags: ['Estratégia'], summary: 'Comparação das estratégias disponíveis nos últimos 2 anos, com comprar e manter como referência',
      description: 'Agrega os resultados do BackTest de cada estratégia (cache de 10 minutos). O 1.º ano conta as vendas feitas '
        + 'nesse ano; o 2.º, as restantes e a posição aberta. buyHold: 15 000 € no início da janela, mantidos até ao fim.',
      querystring: z.object({ scope: z.enum(['all', 'watchlist']).default('all') }),
      response: {
        200: z.object({
          computedAt: z.string(), years: z.number(), budget: z.number(), instruments: z.number(), items: z.array(StrategyStats), buyHold: StrategyStats,
          persistence: z.object({
            computedAt: z.string(), anchor: IsoDate,
            groups: z.array(z.object({ group: z.enum(['gain', 'mixed', 'loss']), n: z.number(), gain: z.number(), mixed: z.number(), loss: z.number(), avgStrategies: z.number(), avgBuyHold: z.number() })),
          }).nullable().describe('Ganhadores e perdedores do 1.º ano: o que aconteceu no 2.º (recálculo semanal; null se ainda não correu)'),
        }),
      },
    },
  }, async (req) => {
    const computed = await ensure(AVAILABLE_STRATEGIES);
    const ids = req.query.scope === 'watchlist' ? await watchlistIds(req.user.id) : null;
    const rowsOf = (k) => computed[k].items.filter((it) => !ids || ids.has(it.instrumentId));
    const sum = (a) => Math.round(a.reduce((x, v) => x + v, 0) * 100) / 100;
    const stats = (id, name, rows, value, extra) => {
      const totals = rows.map(value).sort((a, b) => a - b);
      const peak = sum(rows.map((r) => extra.peak(r)));
      return {
        id, name, total: sum(totals), gain: totals.filter((v) => v > 0).length, loss: totals.filter((v) => v < 0).length,
        peakCost: peak, returnOnPeakPct: peak > 0 ? Math.round((sum(totals) / peak) * 10000) / 100 : 0,
        worst: totals.length ? totals[0] : null, worst10: sum(totals.slice(0, 10)), ...extra.fields(rows),
      };
    };
    const best = new Map();
    AVAILABLE_STRATEGIES.forEach((st, k) => {
      for (const it of rowsOf(k)) if (!best.has(it.instrumentId) || it.total > best.get(it.instrumentId).total) best.set(it.instrumentId, { id: st.id, total: it.total });
    });
    const items = AVAILABLE_STRATEGIES.map((st, k) => {
      const rows = rowsOf(k);
      const closed = sum(rows.map((r) => r.closed));
      const sessions = sum(rows.map((r) => r.sessions));
      return stats(st.id, st.name, rows, (r) => r.total, {
        peak: (r) => r.peakCost,
        fields: () => ({
          positions: closed + rows.filter((r) => r.openPosition).length,
          winRate: closed ? Math.round((sum(rows.map((r) => r.wins)) / closed) * 1000) / 10 : null,
          investedPct: sessions ? Math.round((sum(rows.map((r) => r.investedSessions)) / sessions) * 1000) / 10 : null,
          firstYear: sum(rows.map((r) => r.firstYear)), secondYear: sum(rows.map((r) => r.secondYear)),
          bestIn: [...best.values()].filter((b) => b.id === st.id && b.total > 0).length,
        }),
      });
    });
    // Comprar e manter: a referência calculada pela C-AI (ou pela primeira estratégia), que começa no início da janela.
    const refIdx = Math.max(0, AVAILABLE_STRATEGIES.findIndex((s) => s.id === 'c-ai'));
    const ref = rowsOf(refIdx).filter((r) => r.buyHoldPnl != null);
    const buyHold = stats('buy-hold', 'Comprar e manter', ref, (r) => r.buyHoldPnl, {
      peak: (r) => (r.buyHoldPct ? r.buyHoldPnl / (r.buyHoldPct / 100) : 0),
      fields: () => ({ positions: ref.length, winRate: null, investedPct: 100, firstYear: null, secondYear: null, bestIn: null }),
    });
    const oldest = Math.min(...computed.map((e) => e.at));
    return {
      computedAt: new Date(oldest).toISOString(), years: AVAILABLE_STRATEGIES[0].windowYears, budget: AVAILABLE_STRATEGIES[0].budget,
      instruments: new Set(computed.flatMap((e) => e.items.map((i) => i.instrumentId)).filter((id) => !ids || ids.has(id))).size,
      items, buyHold, persistence: await readAnalysis('winner_persistence').then((r) => r && { computedAt: r.computedAt, anchor: r.anchor, groups: r.groups }),
    };
  });

  // ---------- Melhor estratégia de cada instrumento (página Acompanhar e omissão na página do instrumento) ----------

  app.get('/strategies/best', {
    schema: {
      tags: ['Estratégia'], summary: 'Estratégia com melhor resultado em cada instrumento, nos últimos 2 anos',
      description: 'Usa os resultados do BackTest de todas as estratégias disponíveis (cache de 10 minutos). total é o resultado '
        + 'da melhor estratégia; pode ser negativo, quando nenhuma ganha nesse instrumento.',
      response: {
        200: z.object({
          computedAt: z.string(),
          items: z.array(z.object({
            instrumentId: z.number(), strategyId: z.string(), total: Money, totalPct: z.number(),
          })),
        }),
      },
    },
  }, async () => {
    const computed = await ensure(AVAILABLE_STRATEGIES);
    const best = new Map();
    AVAILABLE_STRATEGIES.forEach((st, k) => {
      for (const it of computed[k].items) {
        const cur = best.get(it.instrumentId);
        if (!cur || it.total > cur.total) best.set(it.instrumentId, { instrumentId: it.instrumentId, strategyId: st.id, total: it.total, totalPct: it.totalPct });
      }
    });
    return { computedAt: new Date(Math.min(...computed.map((e) => e.at))).toISOString(), items: [...best.values()] };
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
            inWatchlist: z.boolean().describe('Está na lista de acompanhamento do utilizador'),
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
    const mine = await watchlistIds(req.user.id);
    items = items.map((i) => ({ ...i, inWatchlist: mine.has(i.instrumentId) }));
    if (req.query.scope === 'watchlist') items = items.filter((i) => i.inWatchlist);
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

  // ---------- Promessas: instrumentos com mais probabilidade de ganhar nos 12 meses seguintes ----------

  // Validação da pontuação feita a 24 out. 2026 (docs/arquitectura/promessas.md): 30 melhores em cada data do passado.
  const VALIDATION = [
    { from: '2025-10-23', to: '2026-10-23', catalogWinners: 27, catalogReturn: 13, topWinners: 47, topReturn: 26 },
    { from: '2026-04-23', to: '2026-10-23', catalogWinners: 18, catalogReturn: 4, topWinners: 20, topReturn: 1 },
    { from: '2025-10-23', to: '2026-04-23', catalogWinners: 26, catalogReturn: 9, topWinners: 47, topReturn: 20 },
    { from: '2026-01-23', to: '2026-07-23', catalogWinners: 25, catalogReturn: 9, topWinners: 57, topReturn: 19 },
    { from: '2026-01-23', to: '2026-10-23', catalogWinners: 21, catalogReturn: 6, topWinners: 27, topReturn: 11 },
  ];
  /** Resultado gravado por scripts/analysis-revalidation.mjs (stocks-analysis.timer), ou null se ainda não correu. */
  async function readAnalysis(name) {
    const [[r]] = await pool.query('SELECT data, computed_at FROM analysis_results WHERE name = ?', [name]);
    return r ? { ...JSON.parse(r.data), computedAt: r.computed_at.toISOString() } : null;
  }

  let promCache = null;
  let promJob = null; // cálculo em curso, partilhado por pedidos simultâneos (memória)

  async function computePromessas() {
    const [instruments] = await pool.query(
      "SELECT id, symbol, name, exchange FROM instruments WHERE status = 'active' AND last_session IS NOT NULL ORDER BY id",
    );
    const list = [];
    for (const inst of instruments) { // um instrumento de cada vez (memória)
      const [quotes] = await pool.query(
        `SELECT session_date AS date, open, high, low, close, adj_close AS adjClose, volume FROM daily_quotes
          WHERE instrument_id = ? ORDER BY session_date DESC LIMIT ?`,
        [inst.id, promessas.SESSIONS_NEEDED + 20],
      );
      list.push({ instrumentId: Number(inst.id), symbol: inst.symbol, name: inst.name, exchange: inst.exchange, features: promessas.features(quotes.reverse()) });
    }
    const ranked = promessas.rank(list);
    const [wlA, ...wlRest] = await ensure(AVAILABLE_STRATEGIES);
    const winners = new Set(wlA.items.filter((it) => it.total > 0 && wlRest.every((e) => (e.items.find((x) => x.instrumentId === it.instrumentId)?.total ?? 0) > 0)).map((it) => it.instrumentId));
    const items = ranked.filter((r) => r.eligible).map((r) => ({
      instrumentId: r.instrumentId, symbol: r.symbol, name: r.name, exchange: r.exchange, rank: r.rank, score: r.score,
      date: r.features.date, close: r.features.close, m2: r.features.m2, vol63: r.features.vol63, s200slope: r.features.s200slope,
      r63: r.features.r63, r252: r.features.r252, distHigh: r.features.distHigh, pastWinner: winners.has(r.instrumentId),
    }));
    return { at: Date.now(), items, ranked: ranked.length, asOf: items.reduce((m, i) => (i.date > m ? i.date : m), '') || null };
  }

  app.get('/promessas', {
    schema: {
      tags: ['Estratégia'], summary: 'Promessas: instrumentos com sinais de continuarem ou passarem a ganhadores nos 12 meses seguintes',
      description: 'Elegíveis: fecho acima da SMA200, SMA50 acima da SMA200 e rendimento de 3 meses positivo. Pontuação 0–100: '
        + 'percentis em todo o catálogo de M2 (peso 2), volatilidade de 3 meses (menor é melhor) e inclinação da SMA200 em 3 meses. '
        + 'pastWinner: ganhador em todas as estratégias nos últimos 2 anos (BackTest). Validação histórica em validation. Não é recomendação.',
      querystring: z.object({ scope: z.enum(['all', 'watchlist']).default('all') }),
      response: {
        200: z.object({
          computedAt: z.string(), asOf: IsoDate.nullable(), topN: z.number(),
          counts: z.object({ eligible: z.number(), ranked: z.number() }),
          validation: z.array(z.object({ from: IsoDate, to: IsoDate, catalogWinners: z.number(), catalogReturn: z.number(), topWinners: z.number(), topReturn: z.number() })),
          validatedAt: z.string().nullable().describe('Data do último recálculo semanal da validação (null: validação inicial de 24 out. 2026)'),
          items: z.array(z.object({
            instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), exchange: z.string().nullable(),
            rank: z.number(), score: z.number(), date: IsoDate, close: z.number(),
            m2: z.number(), vol63: z.number(), s200slope: z.number(), r63: z.number(), r252: z.number(), distHigh: z.number(),
            pastWinner: z.boolean().nullable(),
          })),
        }),
      },
    },
  }, async (req) => {
    if (!promCache || Date.now() - promCache.at > CACHE_MS) {
      promJob ??= computePromessas().finally(() => { promJob = null; });
      promCache = await promJob;
    }
    let { items } = promCache;
    if (req.query.scope === 'watchlist') items = await onlyWatchlist(req.user.id, items);
    const stored = await readAnalysis('promessas_validation');
    return {
      computedAt: new Date(promCache.at).toISOString(), asOf: promCache.asOf, topN: promessas.TOP_N,
      counts: { eligible: promCache.items.length, ranked: promCache.ranked },
      validation: stored?.windows.map(({ from, to, catalogWinners, catalogReturn, topWinners, topReturn }) => ({ from, to, catalogWinners, catalogReturn, topWinners, topReturn })) ?? VALIDATION,
      validatedAt: stored?.computedAt ?? null, items,
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

  async function watchlistIds(userId) {
    const [w] = await pool.query('SELECT instrument_id FROM watchlist_items WHERE user_id = ?', [userId]);
    return new Set(w.map((x) => Number(x.instrument_id)));
  }

  async function onlyWatchlist(userId, items) {
    const ids = await watchlistIds(userId);
    return items.filter((i) => ids.has(i.instrumentId));
  }
}
