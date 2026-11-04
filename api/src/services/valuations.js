import { annualEps, parseFinancials, valuation } from '../valuation.js';
import { latestQuotes } from './quotes.js';

/**
 * Valorização de todos os instrumentos activos com perfil (página «Pechinchas»), com as mesmas regras de
 * GET /instruments/{id}/valuation. Três consultas para o catálogo inteiro (perfis, últimos fechos, fechos desde o
 * primeiro resultado anual) e uma cache em memória que só é refeita quando muda a última sessão ou um perfil.
 */
let cache = { key: null, rows: null };

export function clearValuationsCache() {
  cache = { key: null, rows: null };
}

export async function allValuations(pool) {
  const [[stamp]] = await pool.query(
    `SELECT (SELECT MAX(last_session) FROM instruments WHERE status = 'active') AS s,
            (SELECT MAX(updated_at) FROM company_profiles) AS p,
            (SELECT COUNT(*) FROM company_profiles) AS n`,
  );
  const key = `${stamp.s}|${stamp.p?.toISOString?.() ?? stamp.p}|${stamp.n}`;
  if (cache.key === key) return cache.rows;

  const [profiles] = await pool.query(
    `SELECT p.*, i.symbol, i.name AS instrument_name, i.exchange FROM company_profiles p JOIN instruments i ON i.id = p.instrument_id
      WHERE p.status = 'ok' AND p.fetched_at IS NOT NULL AND i.status = 'active'`,
  );
  const quotes = await latestQuotes(pool, profiles.map((p) => p.instrument_id));
  const withQuote = profiles.filter((p) => quotes.has(Number(p.instrument_id)));
  const financials = new Map(withQuote.map((p) => [Number(p.instrument_id), parseFinancials(p.financials)]));

  const firstYears = [...financials.values()].map((f) => f.find((r) => annualEps(r) != null)?.year).filter(Boolean);
  const closes = new Map();
  if (firstYears.length) {
    const [rows] = await pool.query(
      'SELECT instrument_id, session_date AS date, close FROM daily_quotes WHERE instrument_id IN (?) AND session_date >= ? ORDER BY session_date',
      [withQuote.map((p) => p.instrument_id), `${Math.min(...firstYears) + 1}-04-01`],
    );
    for (const r of rows) {
      const id = Number(r.instrument_id);
      if (!closes.has(id)) closes.set(id, []);
      closes.get(id).push({ date: r.date, close: r.close });
    }
  }

  const bySector = new Map();
  for (const p of withQuote) {
    if (!p.sector) continue;
    if (!bySector.has(p.sector)) bySector.set(p.sector, []);
    bySector.get(p.sector).push({ row: p, close: quotes.get(Number(p.instrument_id)).close });
  }

  const rows = withQuote.map((p) => {
    const id = Number(p.instrument_id);
    const latest = quotes.get(id);
    const peers = (bySector.get(p.sector) ?? []).filter((x) => x.row !== p);
    const v = valuation({ row: p, close: latest.close, closeDate: latest.date, financials: financials.get(id), closes: closes.get(id) ?? [], peers });
    const pe = v.sector.metrics.find((m) => m.key === 'pe');
    return {
      instrumentId: id, symbol: p.symbol, name: p.long_name || p.instrument_name, exchange: p.exchange, sector: p.sector,
      price: v.price, priceDate: v.priceDate, currency: v.currency,
      verdict: v.summary.verdict, cheap: v.summary.cheap, expensive: v.summary.expensive, total: v.summary.total,
      criteria: { sector: v.sector.verdict, history: v.history.verdict, analysts: v.analysts.verdict, graham: v.graham.verdict },
      pe: v.metrics.pe, sectorPe: pe?.sectorMedian ?? null, sectorScore: v.sector.score,
      dividendYield: v.metrics.dividendYield, upside: v.analysts.upside, analysts: v.analysts.count,
      grahamGap: v.graham.ratio == null ? null : v.graham.ratio - 1,
    };
  }).sort((a, b) => a.symbol.localeCompare(b.symbol));
  cache = { key, rows };
  return rows;
}
