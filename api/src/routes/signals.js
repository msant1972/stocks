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

const MAX_SESSIONS = 20; // o máximo de sessões que o pedido aceita

/**
 * Aplica uma estratégia do registo (a mesma da página do instrumento) a todos os instrumentos activos e
 * devolve por instrumento os sinais das últimas MAX_SESSIONS sessões. A A-Momentum usa todo o histórico (para
 * reconstruir a posição virtual de cada um); as estratégias com aquecimento recebem todo o histórico e actuam
 * na janela do BackTest. Um instrumento de cada vez, guardando só o fim da série: carregar e guardar todas as
 * cotações esgotava a memória da API.
 */
async function computeAll(pool, strategy) {
  const [instruments] = await pool.query(
    "SELECT id, symbol, name, last_session FROM instruments WHERE status = 'active' AND last_session IS NOT NULL ORDER BY id",
  );
  const out = [];
  for (const inst of instruments) {
    const [quotes] = await pool.query(
      `SELECT session_date AS date, open, high, low, close, adj_close AS adjClose, volume, sma10, sma125, sma200
         FROM daily_quotes WHERE instrument_id = ? ORDER BY session_date`,
      [inst.id],
    );
    if (!quotes.length) continue;
    const mom = momentum(quotes);
    const from = strategy.warmupYears > 0 ? yearsBefore(inst.last_session, strategy.windowYears) : undefined;
    const result = strategy.run(quotes, { mom, from });
    const tail = quotes.slice(-MAX_SESSIONS).map((q) => ({ date: q.date, close: q.close }));
    out.push({
      id: Number(inst.id), symbol: inst.symbol, name: inst.name, quotes: tail, wave: mom.at(-1).wave,
      signals: result.signals.filter((x) => x.date >= tail[0].date),
    });
  }
  return out;
}

export default async function signalRoutes(app, { pool }) {
  const cache = new Map(); // por estratégia
  let running = Promise.resolve();

  app.get('/signals', {
    schema: {
      tags: ['Sinais'], summary: 'Sinais de uma estratégia em todos os instrumentos (últimas N sessões)',
      description: 'Estratégias: ' + AVAILABLE_STRATEGIES.map((x) => `${x.id} (${x.name}: ${x.rules})`).join(' ')
        + ' Simulação; não são recomendações.',
      querystring: z.object({
        sessions: z.coerce.number().int().min(1).max(MAX_SESSIONS).default(5),
        strategy: z.enum(AVAILABLE_STRATEGIES.map((s) => s.id)).default(DEFAULT_STRATEGY_ID),
      }),
      response: {
        200: z.object({ strategy: z.string(), sessions: z.number(), latestSession: IsoDate.nullable(), items: z.array(Signal) }),
      },
    },
  }, async (req) => {
    const strategy = getStrategy(req.query.strategy);
    // Pedidos simultâneos partilham o cálculo e as estratégias são calculadas uma de cada vez.
    const job = running.then(async () => {
      let e = cache.get(strategy.id);
      if (!e || Date.now() - e.at > CACHE_MS) {
        e = { at: Date.now(), data: await computeAll(pool, strategy) };
        cache.set(strategy.id, e);
      }
      return e;
    });
    running = job.catch(() => {});
    const entry = await job;
    const { sessions } = req.query;
    const items = [];
    let latestSession = null;
    for (const inst of entry.data) {
      const { quotes } = inst;
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
          momentumPct: inst.wave == null ? null : inst.wave.toFixed(2),
        });
      }
    }
    items.sort((a, b) => (a.date === b.date ? a.symbol.localeCompare(b.symbol) : b.date.localeCompare(a.date)));
    return { strategy: strategy.id, sessions, latestSession, items };
  });
}
