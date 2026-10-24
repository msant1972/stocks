import { z } from 'zod';
import { momentum } from '../../../shared/momentum.js';
import { getStrategy } from '../../../shared/strategies/index.js';

// Os sinais são os da A-Momentum (a estratégia que gera compras, reforços e vendas por sessão).
const STRATEGY = getStrategy('a-momentum');
import { IsoDate } from '../schemas.js';

const CACHE_MS = 10 * 60_000; // as cotações só mudam com a recolha diária

const Signal = z.object({
  instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(),
  side: z.enum(['buy', 'add', 'sell']),
  date: IsoDate, sessionsAgo: z.number(),
  price: z.string().describe('Fecho real na sessão do sinal'),
  lastClose: z.string(), lastDate: IsoDate,
  changeSincePct: z.string().describe('Variação do fecho real desde o sinal, em %'),
  momentumPct: z.string().nullable().describe('SMA10/SMA200 − 1 na última sessão, em %'),
});

/**
 * Aplica a A-Momentum (shared/strategies/a-momentum.js, a mesma da página do instrumento) a todos os
 * instrumentos activos, com todo o histórico, e devolve por instrumento a lista de sinais com a posição.
 */
async function computeAll(pool) {
  const [rows] = await pool.query(
    `SELECT q.instrument_id, i.symbol, i.name, q.session_date AS date, q.close, q.adj_close AS adjClose,
            q.sma10, q.sma125, q.sma200
       FROM daily_quotes q JOIN instruments i ON i.id = q.instrument_id
      WHERE i.status = 'active'
      ORDER BY q.instrument_id, q.session_date`,
  );
  const byInstrument = new Map();
  for (const r of rows) {
    const id = Number(r.instrument_id);
    if (!byInstrument.has(id)) byInstrument.set(id, { id, symbol: r.symbol, name: r.name, quotes: [] });
    byInstrument.get(id).quotes.push(r);
  }
  const out = [];
  for (const inst of byInstrument.values()) {
    const mom = momentum(inst.quotes);
    const result = STRATEGY.run(inst.quotes, { mom });
    out.push({ ...inst, mom, signals: result.signals });
  }
  return out;
}

export default async function signalRoutes(app, { pool }) {
  let cache = null;

  app.get('/signals', {
    schema: {
      tags: ['Sinais'], summary: 'Sinais da estratégia de momento em todos os instrumentos (últimas N sessões)',
      description: 'Compra: SMA10/SMA200 descer-subir-subir sem posição virtual; reforço: +10% desde a última compra; '
        + 'venda: subir-descer-descer com SMA8/SMA125 < 1%. Sinais ignorados na zona neutra (±1%). Simulação; não são recomendações.',
      querystring: z.object({ sessions: z.coerce.number().int().min(1).max(20).default(5) }),
      response: {
        200: z.object({ sessions: z.number(), latestSession: IsoDate.nullable(), items: z.array(Signal) }),
      },
    },
  }, async (req) => {
    if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), data: await computeAll(pool) };
    const { sessions } = req.query;
    const items = [];
    let latestSession = null;
    for (const inst of cache.data) {
      const { quotes, mom } = inst;
      const last = quotes.at(-1);
      if (!last) continue;
      if (!latestSession || last.date > latestSession) latestSession = last.date;
      // Janela: as últimas N sessões do próprio instrumento.
      const fromIdx = Math.max(0, quotes.length - sessions);
      const fromDate = quotes[fromIdx].date;
      for (const s of inst.signals) {
        if (s.date < fromDate) continue;
        const idx = quotes.findIndex((q) => q.date === s.date);
        const price = quotes[idx].close;
        items.push({
          instrumentId: inst.id, symbol: inst.symbol, name: inst.name, side: s.side,
          date: s.date, sessionsAgo: quotes.length - 1 - idx,
          price, lastClose: last.close, lastDate: last.date,
          changeSincePct: ((Number(last.close) / Number(price) - 1) * 100).toFixed(2),
          momentumPct: mom.at(-1).wave == null ? null : mom.at(-1).wave.toFixed(2),
        });
      }
    }
    items.sort((a, b) => (a.date === b.date ? a.symbol.localeCompare(b.symbol) : b.date.localeCompare(a.date)));
    return { sessions, latestSession, items };
  });
}
