/**
 * Cálculo das estratégias em todo o catálogo (BackTest, Comparar, WinnersLoosers, Promessas, melhor estratégia).
 * Corre em worker threads, uma estratégia por núcleo (services/strategy-worker.js), para não bloquear a API;
 * computeStrategies também pode ser chamado directamente (fallback e testes).
 */
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { yearsBefore } from '../dates.js';
import { buyHoldCosts, strategyCosts } from '../../../shared/costs.js';
import { PERIODS } from '../../../shared/strategies/index.js';

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
 * period: 'recent' (os últimos windowYears anos) ou 'verification' (os windowYears anos antes deles, com o aquecimento
 * antes desses; dados que não serviram para afinar as estratégias). Cada linha traz também os custos estimados das
 * ordens (shared/costs.js), para o modo «com custos».
 * Devolve Map(id da estratégia → linhas).
 */
export async function computeStrategies(pool, strategies, { part = 0, of = 1, period = 'recent' } = {}) {
  const shift = PERIODS[period] ?? 0;
  const histYears = shift + Math.max(...strategies.map((st) => st.windowYears + st.warmupYears));
  const [all] = await pool.query(
    "SELECT id, symbol, name, exchange, last_session FROM instruments WHERE status = 'active' AND last_session IS NOT NULL ORDER BY id",
  );
  // part/of: só a fracção dos instrumentos deste worker (o catálogo é dividido entre os workers).
  const instruments = all.filter((_, i) => i % of === part);
  const out = new Map(strategies.map((st) => [st.id, []]));
  for (const inst of instruments) {
    const [quotes] = await pool.query(
      `SELECT session_date AS date, open, high, low, close, adj_close AS adjClose, volume, sma10, sma125, sma200
         FROM daily_quotes WHERE instrument_id = ? AND session_date >= ? ORDER BY session_date`,
      [inst.id, yearsBefore(inst.last_session, histYears)],
    );
    const end = shift ? yearsBefore(inst.last_session, shift) : inst.last_session;
    for (const st of strategies) {
      const histFrom = yearsBefore(end, st.windowYears + st.warmupYears);
      const from = yearsBefore(end, st.windowYears);
      const q = quotes.filter((r) => r.date >= histFrom && r.date <= end); // a mesma janela que GET /instruments/{id}/quotes?from=
      if (!q.length || q.at(-1).date < from) continue;
      const r = st.run(q, { from });
      const s = r.summary;
      const window = q.filter((x) => x.date >= from);
      const mid = yearsBefore(end, st.windowYears - 1);
      const e = exposure(r, window, mid);
      const lastDate = q.at(-1).date;
      const c = strategyCosts(r, { mid, lastDate });
      out.get(st.id).push({
        instrumentId: Number(inst.id), symbol: inst.symbol, name: inst.name, exchange: inst.exchange,
        fromDate: r.firstDate, toDate: q.at(-1).date, sessions: q.filter((x) => x.date >= from).length,
        closed: s.closed, wins: s.wins, reinforcements: s.reinforcements, openPosition: r.open != null,
        peakCost: s.peakCost, realized: s.realized, unrealized: s.unrealized, total: s.total,
        totalPct: Math.round(s.totalPct * 100) / 100,
        buyHoldPnl: s.buyHold?.pnl ?? null,
        buyHoldPct: s.buyHold ? Math.round(s.buyHold.pnlPct * 100) / 100 : null,
        investedSessions: e.invested, firstYear: e.firstYear, secondYear: e.secondYear,
        windowFrom: from, costs: c.total, costsFirstYear: c.firstYear, costsSecondYear: c.secondYear, orders: c.orders, winsNet: c.winsNet,
        buyHoldCost: s.buyHold?.cost ?? null, buyHoldCosts: buyHoldCosts(s.buyHold, lastDate),
      });
    }
  }
  return out;
}


/**
 * Calcula as estratégias em paralelo: o catálogo é dividido entre workers (um por núcleo), cada um com a sua ligação
 * à BD e todas as estratégias, para cada cotação ser lida uma só vez. Se os workers falharem (ex.: ambiente sem
 * worker threads), calcula aqui mesmo. Devolve Map(id → linhas), ordenadas por instrumento como no cálculo único.
 */
export async function computeStrategiesParallel(pool, db, strategies, log, period = 'recent') {
  const n = Math.max(1, os.availableParallelism());
  try {
    const parts = await Promise.all(Array.from({ length: n }, (_, part) => new Promise((resolve, reject) => {
      const w = new Worker(new URL('./strategy-worker.js', import.meta.url), {
        workerData: { db, ids: strategies.map((st) => st.id), part, of: n, period }, execArgv: [],
      });
      w.once('message', resolve);
      w.once('error', reject);
      w.once('exit', (code) => { if (code !== 0) reject(new Error(`worker terminou com o código ${code}`)); });
    })));
    return new Map(strategies.map((st) => [st.id, parts.flatMap((m) => m[st.id]).sort((a, b) => a.instrumentId - b.instrumentId)]));
  } catch (err) {
    log?.warn({ err }, 'estratégias: workers indisponíveis; cálculo no processo da API');
    return computeStrategies(pool, strategies, { period });
  }
}
