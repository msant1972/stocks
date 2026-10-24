import { z } from 'zod';
import { momentum } from '../../../shared/momentum.js';
import { backtest, STRATEGY_BUDGET } from '../../../shared/strategy.js';
import { IsoDate } from '../schemas.js';
import { yearsBefore } from './instruments.js';

const CACHE_MS = 10 * 60_000; // as cotações só mudam com a recolha diária
const YEARS = 2;

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
 * Aplica a estratégia de momento (shared/strategy.js, a mesma do botão «Aplicar estratégia» na página do
 * instrumento) a cada instrumento activo, sobre os mesmos dados que essa página carrega: os últimos 2 anos
 * até à última sessão do instrumento. Por isso os valores coincidem com os do gráfico.
 */
async function computeAll(pool) {
  const [rows] = await pool.query(
    `SELECT q.instrument_id, i.symbol, i.name, i.exchange, i.last_session, q.session_date AS date, q.close,
            q.adj_close AS adjClose, q.sma10, q.sma125, q.sma200
       FROM daily_quotes q JOIN instruments i ON i.id = q.instrument_id
      WHERE i.status = 'active' AND q.session_date >= i.last_session - INTERVAL ${YEARS} YEAR - INTERVAL 1 DAY
      ORDER BY q.instrument_id, q.session_date`,
  );
  const byInstrument = new Map();
  for (const r of rows) {
    const id = Number(r.instrument_id);
    if (!byInstrument.has(id)) {
      byInstrument.set(id, { id, symbol: r.symbol, name: r.name, exchange: r.exchange, from: yearsBefore(r.last_session, YEARS), quotes: [] });
    }
    const inst = byInstrument.get(id);
    if (r.date >= inst.from) inst.quotes.push(r); // a mesma janela que GET /instruments/{id}/quotes
  }
  const items = [];
  for (const inst of byInstrument.values()) {
    if (!inst.quotes.length) continue;
    const r = backtest(inst.quotes, momentum(inst.quotes));
    const s = r.summary;
    items.push({
      instrumentId: inst.id, symbol: inst.symbol, name: inst.name, exchange: inst.exchange,
      fromDate: r.firstDate, toDate: inst.quotes.at(-1).date, sessions: inst.quotes.length,
      closed: s.closed, wins: s.wins, reinforcements: s.reinforcements, openPosition: r.open != null,
      peakCost: s.peakCost, realized: s.realized, unrealized: s.unrealized, total: s.total,
      totalPct: Math.round(s.totalPct * 100) / 100,
      buyHoldPnl: s.buyHold?.pnl ?? null,
      buyHoldPct: s.buyHold ? Math.round(s.buyHold.pnlPct * 100) / 100 : null,
    });
  }
  return items;
}

export default async function backtestRoutes(app, { pool }) {
  let cache = null;

  app.get('/backtest', {
    schema: {
      tags: ['Estratégia'], summary: 'Resultado da estratégia de momento em cada instrumento, nos últimos 2 anos',
      description: `Compras de ${STRATEGY_BUDGET} € (descer-subir-subir do SMA10/SMA200), reforços a +10% desde a última compra, `
        + 'venda com subir-descer-descer e SMA8/SMA125 < 1%; sinais ignorados na zona neutra (±1%). Posições abertas '
        + 'avaliadas ao último fecho. Simulação no histórico, sem comissões; não altera a carteira nem é recomendação.',
      querystring: z.object({ scope: z.enum(['all', 'watchlist']).default('all') }),
      response: {
        200: z.object({
          years: z.number(), budget: z.number(), computedAt: z.string(), items: z.array(Row),
        }),
      },
    },
  }, async (req) => {
    if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), items: await computeAll(pool) };
    let { items } = cache;
    if (req.query.scope === 'watchlist') {
      const [w] = await pool.query('SELECT instrument_id FROM watchlist_items WHERE user_id = ?', [req.user.id]);
      const ids = new Set(w.map((x) => Number(x.instrument_id)));
      items = items.filter((i) => ids.has(i.instrumentId));
    }
    return { years: YEARS, budget: STRATEGY_BUDGET, computedAt: new Date(cache.at).toISOString(), items };
  });
}
