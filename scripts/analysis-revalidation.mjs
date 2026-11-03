/**
 * Recalcula, com o histórico disponível, as análises que a aplicação mostra e grava-as em analysis_results:
 *
 * - promessas_validation: a regra das Promessas aplicada em datas anteriores, só com os dados de cada data
 *   (docs/arquitectura/promessas.md). Cinco janelas, contadas a partir da última sessão do catálogo: listas feitas há
 *   12, 9 e 6 meses, com resultado medido 6 meses depois ou até hoje. Para cada janela, os TOP_N primeiros contra todo o
 *   catálogo: % de ganhadores em todas as estratégias disponíveis (a começar sem posição na data da lista) e rendimento
 *   médio de comprar e manter.
 * - winner_persistence: os instrumentos classificados pelo 1.º ano (ganham com todas as estratégias, perdem com todas,
 *   ou misto) e o que aconteceu no 2.º ano (por grupo: quantos ganham/mistos/perdem e resultado médio).
 *
 * Corre semanalmente (stocks-analysis.timer); só escreve em analysis_results.
 *
 *   cd api && node --env-file=../.env ../scripts/analysis-revalidation.mjs [--dry-run]   (--dry-run: mostra sem gravar)
 */
import { createPool, withTransaction } from '../api/src/db.js';
import { loadConfig } from '../api/src/config.js';
import { yearsBefore } from '../api/src/routes/instruments.js';
import * as promessas from '../shared/promessas.js';
import { AVAILABLE_STRATEGIES } from '../shared/strategies/index.js';

/** 'AAAA-MM-DD' recuado n meses (dia ajustado ao fim do mês). */
function monthsBefore(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 - n, d));
  if (t.getUTCDate() !== d) t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
}

/** Resultado de cada estratégia entre from e until (sem posição em from), com o aquecimento que pedir. */
function strategyTotals(quotes, from, until) {
  const q = quotes.filter((r) => r.date <= until);
  const out = [];
  for (const st of AVAILABLE_STRATEGIES) {
    const hist = q.filter((r) => r.date >= yearsBefore(from, st.warmupYears));
    if (!hist.some((r) => r.date >= from)) return null;
    out.push(st.run(hist, { from }).summary.total);
  }
  return out;
}

const group = (totals) => (totals.every((t) => t > 0) ? 'gain' : totals.every((t) => t < 0) ? 'loss' : 'mixed');
const adjAt = (quotes, date) => { const r = quotes.filter((x) => x.date <= date).at(-1); return r ? Number(r.adjClose ?? r.close) : null; };
const pct = (v) => Math.round(v * 100);

const dryRun = process.argv.includes('--dry-run');
const pool = createPool(loadConfig().db);
try {
  const [instruments] = await pool.query(
    "SELECT id, symbol, last_session FROM instruments WHERE status = 'active' AND last_session IS NOT NULL ORDER BY id",
  );
  const anchor = instruments.reduce((m, i) => (i.last_session > m ? i.last_session : m), '');
  const windows = [[12, 0], [6, 0], [12, 6], [9, 3], [9, 0]].map(([a, b]) => ({ from: monthsBefore(anchor, a), to: monthsBefore(anchor, b), at: [], out: new Map() }));
  const persistence = new Map(['gain', 'mixed', 'loss'].map((g) => [g, { group: g, n: 0, gain: 0, mixed: 0, loss: 0, strategies: 0, buyHold: 0 }]));

  for (const inst of instruments) { // um instrumento de cada vez (memória)
    const [quotes] = await pool.query(
      `SELECT session_date AS date, open, high, low, close, adj_close AS adjClose, volume, sma10, sma125, sma200
         FROM daily_quotes WHERE instrument_id = ? AND NOT provisional ORDER BY session_date`,
      [inst.id],
    );
    for (const w of windows) {
      if (!quotes.length || quotes.at(-1).date < w.to || quotes[0].date > w.from) continue;
      const atT = quotes.filter((r) => r.date <= w.from);
      const features = promessas.features(atT.slice(-(promessas.SESSIONS_NEEDED + 20)));
      const totals = strategyTotals(quotes, w.from, w.to);
      const p0 = adjAt(quotes, w.from), p1 = adjAt(quotes, w.to);
      if (!features || !totals || !p0 || !p1) continue;
      w.at.push({ instrumentId: inst.id, symbol: inst.symbol, features });
      w.out.set(inst.id, { winner: group(totals) === 'gain', ret: p1 / p0 - 1 });
    }
    // Persistência: 1.º ano → 2.º ano, na janela de 2 anos de cada instrumento.
    const last = inst.last_session, mid = yearsBefore(last, 1), start = yearsBefore(last, 2);
    if (quotes.length && quotes[0].date <= yearsBefore(last, 3)) {
      const y1 = strategyTotals(quotes, start, mid), y2 = strategyTotals(quotes, mid, last);
      const p0 = adjAt(quotes, mid), p1 = adjAt(quotes, last);
      if (y1 && y2 && p0 && p1) {
        const g = persistence.get(group(y1));
        g.n += 1; g[group(y2)] += 1;
        g.strategies += y2.reduce((a, v) => a + v, 0);
        g.buyHold += (p1 / p0 - 1) * 15000;
      }
    }
  }

  const validation = windows.map((w) => {
    const all = [...w.out.values()];
    const top = promessas.rank(w.at).filter((r) => r.eligible).slice(0, promessas.TOP_N).map((r) => w.out.get(r.instrumentId));
    const share = (a) => (a.length ? pct(a.filter((x) => x.winner).length / a.length) : 0);
    const mean = (a) => (a.length ? pct(a.reduce((s, x) => s + x.ret, 0) / a.length) : 0);
    return { from: w.from, to: w.to, catalogWinners: share(all), catalogReturn: mean(all), topWinners: share(top), topReturn: mean(top), instruments: all.length, top: top.length };
  });
  const groups = [...persistence.values()].map((g) => ({
    group: g.group, n: g.n, gain: g.gain, mixed: g.mixed, loss: g.loss,
    avgStrategies: g.n ? Math.round(g.strategies / g.n) : 0, avgBuyHold: g.n ? Math.round(g.buyHold / g.n) : 0,
  }));
  const strategies = AVAILABLE_STRATEGIES.map((s) => s.id);
  if (!dryRun) await withTransaction(pool, async (conn) => {
    const save = (name, data) => conn.query(
      'INSERT INTO analysis_results (name, data, computed_at) VALUES (?, ?, NOW(3)) ON DUPLICATE KEY UPDATE data = VALUES(data), computed_at = NOW(3)',
      [name, JSON.stringify(data)],
    );
    await save('promessas_validation', { anchor, strategies, windows: validation });
    await save('winner_persistence', { anchor, strategies, groups });
  });
  console.log(`validação das Promessas (${anchor}):`, validation.map((v) => `${v.from}→${v.to} top ${v.topWinners}%/${v.topReturn}% catálogo ${v.catalogWinners}%/${v.catalogReturn}%`).join('; '));
  console.log('persistência:', groups.map((g) => `${g.group} ${g.n} → ${g.gain}/${g.mixed}/${g.loss}`).join('; '));
} finally {
  await pool.end();
}
