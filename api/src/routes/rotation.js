import { z } from 'zod';
import { fundamentalScores } from '../../../shared/fundamentals.js';
import { DEFAULT_OPTIONS } from '../../../shared/strategies/rotacao.js';
import { ErrorBody, IsoDate } from '../schemas.js';
import { rotationService } from '../services/rotation.js';

const N = z.number();
const Pick = z.object({ instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), rank: z.number().nullable(), momentum: N.nullable(), close: N.nullable().optional() });
const Sell = Pick.extend({ reason: z.enum(['ranking', 'filtro']).describe('ranking: caiu abaixo do lugar de manutenção; filtro: já não é elegível (momentum, tendência ou liquidez)') });
const Position = z.object({
  instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), buyDate: IsoDate, quantity: z.number(), cost: N, avgPrice: N,
  pnl: N, pnlPct: N,
});
const Trade = Position.extend({ sellDate: IsoDate, sellPrice: N, proceeds: N });
const Open = Position.extend({ lastDate: IsoDate, lastPrice: N, value: N });

/**
 * Rotação por momentum relativo (estratégia de carteira, docs/arquitectura/Rotacao.md): ao contrário das outras, compara os
 * instrumentos entre si. Resultado simulado do catálogo (ou da lista do utilizador), mais a revisão que se faria com os
 * últimos dados. Não envia ordens: a Automação continua a trabalhar com os sinais de cada instrumento.
 */
export default async function rotationRoutes(app, { pool, warmup = () => {} }) {
  const svc = rotationService(pool);
  warmup(() => svc.run({ period: 'recent' }));
  warmup(() => svc.run({ period: 'verification' }));

  app.get('/strategies/fundamentals', {
    schema: {
      tags: ['Estratégia'], summary: 'Valor e qualidade: ordenação das empresas pelos fundamentais (informativo, sem simulação)',
      description: 'Pontuação de 0 a 1 (média dos percentis de: rendimento dos resultados, rendimento do fluxo de caixa livre, ROE, margem líquida e '
        + 'baixa dívida; mínimo de 4 indicadores). Só há os fundamentais de hoje (sem histórico por data), por isso não se pode simular no '
        + 'passado sem viés de antecipação. `inMomentum` marca as que também estão no topo da rotação por momentum.',
      querystring: z.object({ scope: z.enum(['all', 'watchlist']).default('all'), limit: z.coerce.number().int().min(5).max(100).default(30) }),
      response: {
        200: z.object({
          universe: z.number(), scored: z.number(), fetchedBefore: z.string().nullable(),
          items: z.array(z.object({
            instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), sector: z.string().nullable(), rank: z.number(),
            score: N, value: N.nullable(), quality: N.nullable(),
            earningsYield: N.nullable(), fcfYield: N.nullable(), roe: N.nullable(), margin: N.nullable(), leverage: N.nullable(), inMomentum: z.boolean(),
          })),
        }),
      },
    },
  }, async (req) => {
    const { scope, limit } = req.query;
    const [rows] = await pool.query(
      `SELECT i.id, i.symbol, i.name, p.sector, p.trailing_pe, p.market_cap, p.free_cashflow, p.return_on_equity, p.profit_margin, p.debt_to_equity,
              p.currency, p.financial_currency, p.fetched_at
         FROM instruments i JOIN company_profiles p ON p.instrument_id = i.id
        WHERE i.status = 'active' AND p.status = 'ok'`,
    );
    let universe = rows;
    if (scope === 'watchlist') {
      const [w] = await pool.query('SELECT instrument_id FROM watchlist_items WHERE user_id = ?', [req.user.id]);
      const ids = new Set(w.map((r) => Number(r.instrument_id)));
      universe = rows.filter((r) => ids.has(Number(r.id)));
    }
    const num = (v) => (v == null ? null : Number(v));
    const scored = fundamentalScores(universe.map((r) => ({
      instrumentId: Number(r.id), symbol: r.symbol, name: r.name, sector: r.sector, trailingPe: num(r.trailing_pe), marketCap: num(r.market_cap),
      freeCashflow: num(r.free_cashflow), returnOnEquity: num(r.return_on_equity), profitMargin: num(r.profit_margin), debtToEquity: num(r.debt_to_equity),
      currency: r.currency, financialCurrency: r.financial_currency,
    })));
    const rot = await svc.run({ period: 'recent' });
    const top = new Set((rot?.next.top ?? []).slice(0, DEFAULT_OPTIONS.positions * 2).map((x) => x.instrumentId));
    const oldest = universe.map((r) => r.fetched_at).filter(Boolean).sort()[0];
    return {
      universe: universe.length, scored: scored.length, fetchedBefore: oldest ? new Date(oldest).toISOString() : null,
      items: scored.slice(0, limit).map((x) => ({ ...x, inMomentum: top.has(x.instrumentId) })),
    };
  });

  app.get('/strategies/rotation', {
    schema: {
      tags: ['Estratégia'], summary: 'Rotação por momentum relativo: resultado simulado e revisão seguinte',
      description: 'No último dia útil de cada mês, ordena o universo pelo momentum de 12 meses sem o último e mantém os N melhores '
        + '(só os de momentum positivo, acima da SMA200 e com liquidez), com um lote de 15 000 € por posição; decisão ao fecho, execução '
        + 'à abertura seguinte. Uma posição só sai por ranking quando cai para além do dobro de N. `summary` traz os custos estimados e '
        + 'a comparação com comprar e manter todo o universo em partes iguais. `next` é a revisão que se faria com os últimos dados.',
      querystring: z.object({
        period: z.enum(['recent', 'verification']).default('recent'),
        positions: z.coerce.number().int().refine((n) => [5, 10, 20].includes(n), 'posições: 5, 10 ou 20').default(DEFAULT_OPTIONS.positions),
        scope: z.enum(['all', 'watchlist']).default('all'),
        lookback: z.coerce.number().int().refine((n) => [126, 189, 252].includes(n), 'janela: 126, 189 ou 252 sessões').default(DEFAULT_OPTIONS.lookback),
        regime: z.coerce.number().int().refine((n) => [0, 1, 2].includes(n), 'regime: 0, 1 ou 2').default(0)
          .describe('Filtro de regime de mercado: 0 desligado; 1 sem compras novas com menos de metade do catálogo acima da SMA200; 2 também vende tudo'),
        sizing: z.coerce.number().int().refine((n) => [0, 1].includes(n), 'dimensionamento: 0 ou 1').default(0)
          .describe('0: lotes iguais; 1: pela volatilidade (entre ½ e 2 lotes)'),
      }),
      response: {
        200: z.object({
          period: z.enum(['recent', 'verification']), scope: z.enum(['all', 'watchlist']), universe: z.number(), eligibleNow: z.number(),
          firstDate: IsoDate.nullable(), lastDate: IsoDate.nullable(), latestSession: IsoDate.nullable(),
          options: z.object({ positions: z.number(), keepRank: z.number(), lookback: z.number(), skip: z.number(), smaTrend: z.number(), minTradedValue: z.number(), budget: z.number(), regime: z.number(), regimeMin: z.number(), sizing: z.number() }),
          summary: z.object({
            closed: z.number(), wins: z.number(), winsNet: z.number(), peakCost: N, realized: N, unrealized: N, total: N, totalPct: N,
            costs: N, net: N, netPct: N, maxDrawdown: N, maxDrawdownPct: N, rebalances: z.number(), bearReviews: z.number(), avgPositions: N,
            buyHold: z.object({ instruments: z.number(), cost: N, value: N, pnl: N, pnlPct: N, net: N, netPct: N }).nullable(),
          }),
          curve: z.array(z.object({ date: IsoDate, pnl: N, positions: z.number() })),
          trades: z.array(Trade), open: z.array(Open),
          next: z.object({ date: IsoDate.nullable(), eligible: z.number(), breadth: N.nullable(), bear: z.boolean(), keep: z.array(Pick), buy: z.array(Pick), sell: z.array(Sell), top: z.array(Pick) }),
        }),
        400: ErrorBody,
      },
    },
  }, async (req) => {
    const { period, positions, scope, lookback, regime, sizing } = req.query;
    let ids = null;
    if (scope === 'watchlist') {
      const [w] = await pool.query('SELECT instrument_id FROM watchlist_items WHERE user_id = ?', [req.user.id]);
      ids = new Set(w.map((r) => Number(r.instrument_id)));
    }
    const r = await svc.run({ period, positions, ids, key: scope === 'watchlist' ? `u${req.user.id}` : 'all', lookback, regime, sizing });
    if (!r) {
      return {
        period, scope, universe: 0, eligibleNow: 0, firstDate: null, lastDate: null, latestSession: null,
        options: { ...DEFAULT_OPTIONS, positions, keepRank: positions * 2, lookback, regime, sizing }, summary: emptySummary(), curve: [],
        trades: [], open: [], next: { date: null, eligible: 0, breadth: null, bear: false, keep: [], buy: [], sell: [], top: [] },
      };
    }
    // A curva traz uma sessão por semana (a última de cada semana) para não pesar: ~100 pontos em 2 anos.
    const curve = r.curve.filter((c, i, a) => i === a.length - 1 || weekOf(c.date) !== weekOf(a[i + 1].date));
    const { universe, latestSession, next } = r;
    return {
      period, scope, universe, eligibleNow: r.next.eligible, firstDate: r.firstDate, lastDate: r.lastDate, latestSession,
      options: pickOptions(r.options), summary: pickSummary(r.summary), curve,
      trades: r.trades.map(pickTrade).sort((a, b) => b.sellDate.localeCompare(a.sellDate)), open: r.open.map(pickOpen),
      next,
    };
  });
}

/** Número da semana ISO aproximado (ano + dia do ano / 7): só serve para agrupar sessões da mesma semana. */
function weekOf(date) {
  const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * 86_400_000;
  return Math.floor(monday / 86_400_000);
}
const pickOptions = (o) => ({ positions: o.positions, keepRank: o.keepRank, lookback: o.lookback, skip: o.skip, smaTrend: o.smaTrend, minTradedValue: o.minTradedValue, budget: o.budget, regime: o.regime, regimeMin: o.regimeMin, sizing: o.sizing });
const pickSummary = (s) => ({
  closed: s.closed, wins: s.wins, winsNet: s.winsNet, peakCost: s.peakCost, realized: s.realized, unrealized: s.unrealized, total: s.total, totalPct: s.totalPct,
  costs: s.costs, net: s.net, netPct: s.netPct, maxDrawdown: s.maxDrawdown, maxDrawdownPct: s.maxDrawdownPct, rebalances: s.rebalances, bearReviews: s.bearReviews ?? 0, avgPositions: s.avgPositions, buyHold: s.buyHold,
});
const pickPos = (p) => ({ instrumentId: p.instrumentId, symbol: p.symbol, name: p.name, buyDate: p.buyDate, quantity: p.quantity, cost: p.cost, avgPrice: p.avgPrice, pnl: p.pnl, pnlPct: p.pnlPct });
const pickTrade = (t) => ({ ...pickPos(t), sellDate: t.sellDate, sellPrice: t.sellPrice, proceeds: t.proceeds });
const pickOpen = (p) => ({ ...pickPos(p), lastDate: p.lastDate, lastPrice: p.lastPrice, value: p.value });
const emptySummary = () => ({
  closed: 0, wins: 0, winsNet: 0, peakCost: 0, realized: 0, unrealized: 0, total: 0, totalPct: 0, costs: 0, net: 0, netPct: 0,
  maxDrawdown: 0, maxDrawdownPct: 0, rebalances: 0, bearReviews: 0, avgPositions: 0, buyHold: null,
});
