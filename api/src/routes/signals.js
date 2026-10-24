import { z } from 'zod';
import { momentum } from '../../../shared/momentum.js';
import { AVAILABLE_STRATEGIES, DEFAULT_STRATEGY_ID, getStrategy } from '../../../shared/strategies/index.js';
import { IsoDate } from '../schemas.js';
import { yearsBefore } from './instruments.js';

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

/**
 * Aplica uma estratégia do registo (a mesma da página do instrumento) a todos os instrumentos activos e
 * devolve por instrumento a lista de sinais. A A-Momentum usa todo o histórico (para reconstruir a posição
 * virtual de cada um); as estratégias com aquecimento recebem todo o histórico e actuam na janela do BackTest.
 */
async function computeAll(pool, strategy) {
  const [rows] = await pool.query(
    `SELECT q.instrument_id, i.symbol, i.name, i.last_session, q.session_date AS date, q.open, q.high, q.low, q.close,
            q.adj_close AS adjClose, q.volume, q.sma10, q.sma125, q.sma200
       FROM daily_quotes q JOIN instruments i ON i.id = q.instrument_id
      WHERE i.status = 'active'
      ORDER BY q.instrument_id, q.session_date`,
  );
  const byInstrument = new Map();
  for (const r of rows) {
    const id = Number(r.instrument_id);
    if (!byInstrument.has(id)) byInstrument.set(id, { id, symbol: r.symbol, name: r.name, lastSession: r.last_session, quotes: [] });
    byInstrument.get(id).quotes.push(r);
  }
  const out = [];
  for (const inst of byInstrument.values()) {
    const mom = momentum(inst.quotes);
    const from = strategy.warmupYears > 0 ? yearsBefore(inst.lastSession, strategy.windowYears) : undefined;
    const result = strategy.run(inst.quotes, { mom, from });
    out.push({ ...inst, mom, signals: result.signals });
  }
  return out;
}

export default async function signalRoutes(app, { pool }) {
  const cache = new Map(); // por estratégia

  app.get('/signals', {
    schema: {
      tags: ['Sinais'], summary: 'Sinais de uma estratégia em todos os instrumentos (últimas N sessões)',
      description: 'Estratégias: ' + AVAILABLE_STRATEGIES.map((x) => `${x.id} (${x.name}: ${x.rules})`).join(' ')
        + ' Simulação; não são recomendações.',
      querystring: z.object({
        sessions: z.coerce.number().int().min(1).max(20).default(5),
        strategy: z.enum(AVAILABLE_STRATEGIES.map((s) => s.id)).default(DEFAULT_STRATEGY_ID),
      }),
      response: {
        200: z.object({ strategy: z.string(), sessions: z.number(), latestSession: IsoDate.nullable(), items: z.array(Signal) }),
      },
    },
  }, async (req) => {
    const strategy = getStrategy(req.query.strategy);
    let entry = cache.get(strategy.id);
    if (!entry || Date.now() - entry.at > CACHE_MS) {
      entry = { at: Date.now(), data: await computeAll(pool, strategy) };
      cache.set(strategy.id, entry);
    }
    const { sessions } = req.query;
    const items = [];
    let latestSession = null;
    for (const inst of entry.data) {
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
        // Preço da operação: o da estratégia, se o indicar (ex.: abertura ou stop na B-Opus), senão o fecho real.
        const price = s.price != null ? s.price.toFixed(6) : quotes[idx].close;
        items.push({
          instrumentId: inst.id, symbol: inst.symbol, name: inst.name, side: s.side, reason: s.reason ?? null,
          date: s.date, sessionsAgo: quotes.length - 1 - idx,
          price, lastClose: last.close, lastDate: last.date,
          changeSincePct: ((Number(last.close) / Number(price) - 1) * 100).toFixed(2),
          momentumPct: mom.at(-1).wave == null ? null : mom.at(-1).wave.toFixed(2),
        });
      }
    }
    items.sort((a, b) => (a.date === b.date ? a.symbol.localeCompare(b.symbol) : b.date.localeCompare(a.date)));
    return { strategy: strategy.id, sessions, latestSession, items };
  });
}
