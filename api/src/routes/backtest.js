import { z } from 'zod';
import { ANALYSIS_STRATEGIES, AVAILABLE_STRATEGIES, getStrategy, STRATEGIES } from '../../../shared/strategies/index.js';
import { ErrorBody, IsoDate } from '../schemas.js';
import { bestByInstrument, strategyResults } from '../services/strategyResults.js';
import { assertEnabled, defaultStrategyId, enabledStrategies, setStrategyEnabled } from '../services/strategySettings.js';
import { AppError } from '../errors.js';
import * as promessas from '../../../shared/promessas.js';
import { DEFAULT_COSTS, describeCosts } from '../../../shared/costs.js';

const CACHE_MS = 10 * 60_000; // as cotações só mudam com a recolha diária

const Period = z.enum(['recent', 'verification']).default('recent')
  .describe('recent: os últimos 2 anos; verification: os 2 anos antes deles (dados que não serviram para afinar as estratégias)');
const Costs = z.enum(['true', 'false']).default('false')
  .describe('true: resultados depois dos custos estimados (comissão, spread e custódia da SAXO; ver costModel)');
const CostModel = z.object({
  commissionPct: z.number(), commissionMin: z.number(), spreadPct: z.number(), custodyPctYear: z.number(), text: z.string(),
});
const costModel = () => ({ ...DEFAULT_COSTS, text: describeCosts() });

/** Linha do BackTest depois dos custos: resultado, % sobre o capital, por ano, operações com ganho e comprar e manter. */
export function netOfCosts(r) {
  const round2 = (x) => Math.round(x * 100) / 100;
  const total = round2(r.total - r.costs);
  const buyHoldPnl = r.buyHoldPnl == null ? null : round2(r.buyHoldPnl - (r.buyHoldCosts ?? 0));
  return {
    ...r, total, realized: round2(r.realized - r.costsFirstYear - (r.openPosition ? 0 : r.costsSecondYear)),
    unrealized: r.openPosition ? round2(r.unrealized - r.costsSecondYear) : r.unrealized,
    totalPct: r.peakCost > 0 ? Math.round((total / r.peakCost) * 10000) / 100 : 0,
    firstYear: round2(r.firstYear - r.costsFirstYear), secondYear: round2(r.secondYear - r.costsSecondYear), wins: r.winsNet,
    buyHoldPnl, buyHoldPct: buyHoldPnl == null || !r.buyHoldCost ? r.buyHoldPct : Math.round((buyHoldPnl / r.buyHoldCost) * 10000) / 100,
  };
}

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
  windowFrom: IsoDate.describe('Início da janela (o período pedido); fromDate depois disto: histórico incompleto'),
  costs: Money.describe('Custos estimados das ordens (comissão, spread e custódia), já descontados com costs=true'),
  costsFirstYear: Money, costsSecondYear: Money, orders: z.number().describe('Ordens (compras, reforços e vendas)'),
  winsNet: z.number().describe('Operações fechadas com ganho depois dos custos'),
  buyHoldCost: Money.nullable(), buyHoldCosts: Money.nullable(),
});

export default async function backtestRoutes(app, { pool, cfg, warmup = () => {} }) {

  const StrategyInfo = z.object({ id: z.string(), name: z.string(), available: z.boolean(), summary: z.string(), rules: z.string(), enabled: z.boolean().optional() });
  const info = ({ id, name, available, summary, rules }) => ({ id, name, available, summary, rules });

  app.get('/strategies', {
    schema: {
      tags: ['Estratégia'], summary: 'Estratégias registadas (as não disponíveis estão em preparação)',
      response: { 200: z.object({ defaultId: z.string(), items: z.array(StrategyInfo) }) },
    },
  }, async () => {
    const on = await enabledStrategies(pool);
    return { defaultId: defaultStrategyId(on), items: STRATEGIES.map((s) => ({ ...info(s), enabled: s.available && on.some((x) => x.id === s.id) })) };
  });

  app.put('/strategies/:id/enabled', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['Estratégia'], summary: 'Ligar ou desligar uma estratégia (administradores; vale para todos os módulos)',
      description: 'As estratégias desligadas saem dos resultados de Acompanhar, Sinais, BackTest, Comparar, WinnersLoosers e Charts, e a Automação não as executa. Tem de ficar pelo menos uma ligada (409).',
      params: z.object({ id: z.enum(AVAILABLE_STRATEGIES.map((s) => s.id)) }), body: z.object({ enabled: z.boolean() }),
      response: { 200: z.object({ items: z.array(z.object({ id: z.string(), enabled: z.boolean() })) }), 403: ErrorBody, 409: ErrorBody },
    },
  }, async (req) => {
    if (!req.user.isAdmin) throw new AppError(403, 'FORBIDDEN', 'reservado a administradores');
    await setStrategyEnabled(pool, req.user.id, req.params.id, req.body.enabled);
    const on = await enabledStrategies(pool);
    return { items: AVAILABLE_STRATEGIES.map((s) => ({ id: s.id, enabled: on.some((x) => x.id === s.id) })) };
  });

  app.get('/backtest', {
    schema: {
      tags: ['Estratégia'], summary: 'Resultado de uma estratégia em cada instrumento, nos últimos 2 anos',
      description: 'Estratégias disponíveis: ' + AVAILABLE_STRATEGIES.map((s) => `${s.id} (${s.name}: ${s.rules})`).join(' ')
        + ' Posições abertas avaliadas ao último fecho. Simulação no histórico; não altera a carteira nem é recomendação.',
      querystring: z.object({
        scope: z.enum(['all', 'watchlist']).default('all'),
        strategy: z.enum(AVAILABLE_STRATEGIES.map((s) => s.id)).optional().describe('Por omissão, a A-Momentum ou a primeira ligada'),
        period: Period, costs: Costs,
      }),
      response: {
        200: z.object({
          strategy: StrategyInfo, years: z.number(), budget: z.number().nullable(), computedAt: z.string(),
          period: z.enum(['recent', 'verification']), costs: z.boolean(), costModel: CostModel, items: z.array(Row),
        }),
      },
    },
  }, async (req) => {
    const on = await enabledStrategies(pool);
    const strategy = getStrategy(req.query.strategy ?? defaultStrategyId(on));
    await assertEnabled(pool, strategy.id);
    const { period } = req.query;
    const withCosts = req.query.costs === 'true';
    const entry = (await ensure([strategy], period))[0];
    let { items } = entry;
    if (req.query.scope === 'watchlist') items = await onlyWatchlist(req.user.id, items);
    if (withCosts) items = items.map(netOfCosts);
    return {
      strategy: info(strategy), years: strategy.windowYears, budget: strategy.budget, computedAt: new Date(entry.at).toISOString(),
      period, costs: withCosts, costModel: costModel(), items,
    };
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
      querystring: z.object({ scope: z.enum(['all', 'watchlist']).default('all'), period: Period, costs: Costs }),
      response: {
        200: z.object({
          computedAt: z.string(), years: z.number(), budget: z.number(), instruments: z.number(), items: z.array(StrategyStats), buyHold: StrategyStats,
          period: z.enum(['recent', 'verification']), costs: z.boolean(), costModel: CostModel,
          fromDate: IsoDate.nullable().describe('Início mais comum da janela'), toDate: IsoDate.nullable().describe('Fim mais comum da janela'),
          fullHistory: z.number().describe('Instrumentos com histórico em toda a janela'),
          persistence: z.object({
            computedAt: z.string(), anchor: IsoDate,
            groups: z.array(z.object({ group: z.enum(['gain', 'mixed', 'loss']), n: z.number(), gain: z.number(), mixed: z.number(), loss: z.number(), avgStrategies: z.number(), avgBuyHold: z.number() })),
          }).nullable().describe('Ganhadores e perdedores do 1.º ano: o que aconteceu no 2.º (recálculo semanal; null se ainda não correu)'),
        }),
      },
    },
  }, async (req) => {
    const STS = await enabledStrategies(pool);
    const { period } = req.query;
    const withCosts = req.query.costs === 'true';
    const computed = await ensure(STS, period);
    const ids = req.query.scope === 'watchlist' ? await watchlistIds(req.user.id) : null;
    const rowsOf = (k) => computed[k].items.filter((it) => !ids || ids.has(it.instrumentId)).map((it) => (withCosts ? netOfCosts(it) : it));
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
    STS.forEach((st, k) => {
      for (const it of rowsOf(k)) if (!best.has(it.instrumentId) || it.total > best.get(it.instrumentId).total) best.set(it.instrumentId, { id: st.id, total: it.total });
    });
    const items = STS.map((st, k) => {
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
    const refIdx = Math.max(0, STS.findIndex((s) => s.id === 'c-ai'));
    const ref = rowsOf(refIdx).filter((r) => r.buyHoldPnl != null);
    const buyHold = stats('buy-hold', 'Comprar e manter', ref, (r) => r.buyHoldPnl, {
      peak: (r) => (r.buyHoldPct ? r.buyHoldPnl / (r.buyHoldPct / 100) : 0),
      fields: () => ({ positions: ref.length, winRate: null, investedPct: 100, firstYear: null, secondYear: null, bestIn: null }),
    });
    const oldest = Math.min(...computed.map((e) => e.at));
    const mode = (xs) => { const n = new Map(); for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
    const refRows = rowsOf(refIdx);
    const fromDate = mode(refRows.map((r) => r.windowFrom));
    // Histórico em toda a janela: pelo menos 95 % das sessões do instrumento com mais sessões na janela.
    const maxSessions = Math.max(0, ...refRows.map((r) => r.sessions));
    const fullHistory = refRows.filter((r) => maxSessions > 0 && r.sessions >= 0.95 * maxSessions).length;
    return {
      computedAt: new Date(oldest).toISOString(), years: STS[0].windowYears, budget: STS[0].budget,
      instruments: new Set(computed.flatMap((e) => e.items.map((i) => i.instrumentId)).filter((id) => !ids || ids.has(id))).size,
      items, buyHold, period, costs: withCosts, costModel: costModel(), fromDate, toDate: mode(refRows.map((r) => r.toDate)), fullHistory,
      persistence: period === 'recent'
        ? await readAnalysis('winner_persistence').then((r) => r && { computedAt: r.computedAt, anchor: r.anchor, groups: r.groups }) : null,
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
    const STS = await enabledStrategies(pool);
    const computed = await ensure(STS);
    const best = bestByInstrument(STS, computed);
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
    const STS = await enabledStrategies(pool);
    const computed = await ensure(STS);
    const entries = STS.map((st, k) => [st, computed[k]]);
    const byId = new Map();
    for (const [st, entry] of entries) {
      for (const it of entry.items) {
        if (!byId.has(it.instrumentId)) {
          byId.set(it.instrumentId, { instrumentId: it.instrumentId, symbol: it.symbol, name: it.name, exchange: it.exchange, results: {}, buyHoldPct: it.buyHoldPct });
        }
        byId.get(it.instrumentId).results[st.id] = it.total;
      }
    }
    let items = [...byId.values()].filter((r) => STS.every((st) => r.results[st.id] != null)).map((r) => {
      const values = STS.map((st) => r.results[st.id]);
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
      strategies: STS.map(({ id, name }) => ({ id, name })),
      years: STS[0].windowYears, budget: STS[0].budget, computedAt: new Date(oldest).toISOString(),
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

  /** Recalcula as Promessas (um só cálculo de cada vez, partilhado por quem o pedir). */
  function refreshPromessas() {
    promJob ??= computePromessas().then((c) => { promCache = c; }).finally(() => { promJob = null; });
    return promJob;
  }

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
    const [wlA, ...wlRest] = await ensure(ANALYSIS_STRATEGIES); // o conjunto fixo das Promessas (não as ligadas nas Definições)
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
    // Stale-while-revalidate: com resultado em cache (mesmo antigo) responde logo e recalcula em segundo plano.
    if (!promCache) await refreshPromessas();
    else if (Date.now() - promCache.at > CACHE_MS) refreshPromessas().catch((err) => app.log.warn({ err }, 'promessas: recálculo falhou'));
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

  // Resultados em cache, partilhados com a Automação (services/strategyResults.js).
  const { ensure, recompute } = strategyResults(pool, cfg, app.log);

  // Cálculo antecipado: arranque e cada recolha concluída (services/warmup.js). Estratégias primeiro (as Promessas usam-nas).
  warmup(() => recompute(AVAILABLE_STRATEGIES, true));
  warmup(async () => { await refreshPromessas(); });

  async function watchlistIds(userId) {
    const [w] = await pool.query('SELECT instrument_id FROM watchlist_items WHERE user_id = ?', [userId]);
    return new Set(w.map((x) => Number(x.instrument_id)));
  }

  async function onlyWatchlist(userId, items) {
    const ids = await watchlistIds(userId);
    return items.filter((i) => ids.has(i.instrumentId));
  }
}
