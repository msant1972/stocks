import { z } from 'zod';
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
      }),
      response: {
        200: z.object({
          period: z.enum(['recent', 'verification']), scope: z.enum(['all', 'watchlist']), universe: z.number(), eligibleNow: z.number(),
          firstDate: IsoDate.nullable(), lastDate: IsoDate.nullable(), latestSession: IsoDate.nullable(),
          options: z.object({ positions: z.number(), keepRank: z.number(), lookback: z.number(), skip: z.number(), smaTrend: z.number(), minTradedValue: z.number(), budget: z.number() }),
          summary: z.object({
            closed: z.number(), wins: z.number(), winsNet: z.number(), peakCost: N, realized: N, unrealized: N, total: N, totalPct: N,
            costs: N, net: N, netPct: N, maxDrawdown: N, maxDrawdownPct: N, rebalances: z.number(), avgPositions: N,
            buyHold: z.object({ instruments: z.number(), cost: N, value: N, pnl: N, pnlPct: N, net: N, netPct: N }).nullable(),
          }),
          curve: z.array(z.object({ date: IsoDate, pnl: N, positions: z.number() })),
          trades: z.array(Trade), open: z.array(Open),
          next: z.object({ date: IsoDate.nullable(), eligible: z.number(), keep: z.array(Pick), buy: z.array(Pick), sell: z.array(Sell), top: z.array(Pick) }),
        }),
        400: ErrorBody,
      },
    },
  }, async (req) => {
    const { period, positions, scope } = req.query;
    let ids = null;
    if (scope === 'watchlist') {
      const [w] = await pool.query('SELECT instrument_id FROM watchlist_items WHERE user_id = ?', [req.user.id]);
      ids = new Set(w.map((r) => Number(r.instrument_id)));
    }
    const r = await svc.run({ period, positions, ids, key: scope === 'watchlist' ? `u${req.user.id}` : 'all' });
    if (!r) {
      return {
        period, scope, universe: 0, eligibleNow: 0, firstDate: null, lastDate: null, latestSession: null,
        options: { ...DEFAULT_OPTIONS, positions, keepRank: positions * 2 }, summary: emptySummary(), curve: [],
        trades: [], open: [], next: { date: null, eligible: 0, keep: [], buy: [], sell: [], top: [] },
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
const pickOptions = (o) => ({ positions: o.positions, keepRank: o.keepRank, lookback: o.lookback, skip: o.skip, smaTrend: o.smaTrend, minTradedValue: o.minTradedValue, budget: o.budget });
const pickSummary = (s) => ({
  closed: s.closed, wins: s.wins, winsNet: s.winsNet, peakCost: s.peakCost, realized: s.realized, unrealized: s.unrealized, total: s.total, totalPct: s.totalPct,
  costs: s.costs, net: s.net, netPct: s.netPct, maxDrawdown: s.maxDrawdown, maxDrawdownPct: s.maxDrawdownPct, rebalances: s.rebalances, avgPositions: s.avgPositions, buyHold: s.buyHold,
});
const pickPos = (p) => ({ instrumentId: p.instrumentId, symbol: p.symbol, name: p.name, buyDate: p.buyDate, quantity: p.quantity, cost: p.cost, avgPrice: p.avgPrice, pnl: p.pnl, pnlPct: p.pnlPct });
const pickTrade = (t) => ({ ...pickPos(t), sellDate: t.sellDate, sellPrice: t.sellPrice, proceeds: t.proceeds });
const pickOpen = (p) => ({ ...pickPos(p), lastDate: p.lastDate, lastPrice: p.lastPrice, value: p.value });
const emptySummary = () => ({
  closed: 0, wins: 0, winsNet: 0, peakCost: 0, realized: 0, unrealized: 0, total: 0, totalPct: 0, costs: 0, net: 0, netPct: 0,
  maxDrawdown: 0, maxDrawdownPct: 0, rebalances: 0, avgPositions: 0, buyHold: null,
});
