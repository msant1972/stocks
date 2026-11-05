import { AppError } from '../errors.js';
import { decideMatch, expectedExchange, nameKeywords, nameScore, symbolRoot, toCandidate } from './matching.js';

/**
 * Correspondência do catálogo com a SAXO Bank: pesquisa, gravação (saxo_instruments) e problemas por resolver
 * (saxo_match_issues). Usada na primeira ordem de cada instrumento e na ligação de todo o catálogo (catalog-runner.js).
 */

const exchangeCache = new Map(); // ambiente -> { at, mic: ExchangeId -> MIC, exchange: MIC -> ExchangeId }

/** Bolsas da SAXO (24 h em cache): ExchangeId ↔ MIC. */
export async function exchangeMaps(client, key) {
  const hit = exchangeCache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit;
  const mic = new Map();
  const exchange = new Map();
  try {
    const res = await client.get('/ref/v1/exchanges', { $top: 1000 });
    for (const e of res?.Data ?? []) {
      if (!e.ExchangeId || !e.Mic) continue;
      mic.set(e.ExchangeId, e.Mic);
      if (!exchange.has(e.Mic.toUpperCase())) exchange.set(e.Mic.toUpperCase(), e.ExchangeId);
    }
  } catch (err) {
    if (err.code === 'SAXO_TOKEN_EXPIRED') throw err; // sem mapa, a bolsa vem só da tabela fixa (SAXO_EXCHANGE)
  }
  const maps = { at: Date.now(), mic, exchange };
  if (mic.size) exchangeCache.set(key, maps);
  return maps;
}

export async function storedResolution(pool, instrumentId, environment) {
  const [[r]] = await pool.query('SELECT * FROM saxo_instruments WHERE instrument_id = ? AND environment = ?', [instrumentId, environment]);
  return r ?? null;
}

/** Problema de correspondência por resolver (ambíguo, só noutra bolsa, não encontrado, não negociável, erro). */
export async function recordIssue(pool, instrumentId, environment, status, message, candidates = []) {
  await pool.query(
    `REPLACE INTO saxo_match_issues (instrument_id, environment, status, message, candidates, checked_at)
     VALUES (?, ?, ?, ?, ?, NOW(3))`,
    [instrumentId, environment, status, String(message ?? '').slice(0, 500), JSON.stringify(candidates ?? [])],
  );
}

const clearIssue = (pool, instrumentId, environment) => pool.query(
  'DELETE FROM saxo_match_issues WHERE instrument_id = ? AND environment = ?', [instrumentId, environment],
);

/** Guarda a correspondência escolhida, depois de confirmar nos detalhes da SAXO que é negociável e na moeda certa. */
export async function saveResolution(pool, session, inst, cand, accountKey, source) {
  const d = await session.client.get(`/ref/v1/instruments/details/${cand.uic}/Stock`, { AccountKey: accountKey });
  if (d?.IsTradable === false) throw new AppError(409, 'SAXO_NOT_TRADABLE', `${cand.symbol} não é negociável na conta da SAXO Bank`);
  const currency = d?.CurrencyCode ?? cand.currency;
  if (currency !== inst.currency) throw new AppError(409, 'CURRENCY_MISMATCH', `${cand.symbol} negoceia em ${currency}, não em ${inst.currency}`);
  const types = (d?.SupportedOrderTypes ?? []).join(',');
  const description = d?.Description ?? cand.description ?? '';
  await pool.query(
    `REPLACE INTO saxo_instruments (instrument_id, environment, uic, asset_type, saxo_symbol, exchange_id, currency, description, tradable,
       order_types, min_size, tick_scheme, source, name_score, checked_at)
     VALUES (?, ?, ?, 'Stock', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NOW(3))`,
    [inst.id, session.environment, cand.uic, d?.Symbol ?? cand.symbol, d?.Exchange?.ExchangeId ?? cand.exchangeId, currency, description.slice(0, 255),
      types.slice(0, 255), d?.MinimumTradeSize ?? 1, d?.TickSizeScheme ? JSON.stringify(d.TickSizeScheme) : null, source,
      nameScore(inst.name, description)],
  );
  await clearIssue(pool, inst.id, session.environment);
  return storedResolution(pool, inst.id, session.environment);
}

/**
 * Pesquisa o instrumento na SAXO e decide (matching.js): primeiro pelo ISIN, depois pela raiz do símbolo e, se ainda não
 * houver correspondência clara na bolsa certa, pelo nome da empresa. No máximo 3 pesquisas.
 */
export async function findMatch(session, inst) {
  const maps = await exchangeMaps(session.client, session.environment);
  const exchangeId = expectedExchange(inst, maps.exchange);
  const search = async (kw) => (kw ? (await session.client.get('/ref/v1/instruments', { Keywords: kw, AssetTypes: 'Stock', $top: 50 }))?.Data ?? [] : []);
  const seen = new Map();
  const add = (rows) => { for (const r of rows) seen.set(Number(r.Identifier), toCandidate(r, maps.mic)); return [...seen.values()]; };

  if (inst.isin) {
    const d = decideMatch(inst, add(await search(inst.isin)), { exchangeId, byIsin: true });
    if (d.status === 'auto') return d;
  }
  let d = decideMatch(inst, add(await search(symbolRoot(inst.symbol))), { exchangeId });
  if (d.status !== 'auto' && exchangeId) {
    const kw = nameKeywords(inst.name);
    if (kw && kw.toUpperCase() !== symbolRoot(inst.symbol)) d = decideMatch(inst, add(await search(kw)), { exchangeId });
  }
  return d;
}

const ISSUE_TEXT = {
  ambiguous: (s) => `há várias correspondências para ${s} na SAXO Bank; escolha o instrumento certo`,
  other_market: (s) => `${s} só foi encontrado noutra bolsa da SAXO Bank; escolha um candidato ou deixe sem ligação`,
  not_found: (s) => `${s} não foi encontrado na SAXO Bank`,
};

/**
 * Instrumento da SAXO que corresponde ao da aplicação (na primeira ordem): a correspondência guardada ou uma nova
 * pesquisa. Sem correspondência clara, regista o problema e devolve 409 SAXO_AMBIGUOUS (com os candidatos) ou 422.
 */
export async function resolveInstrument(pool, session, inst, accountKey) {
  const known = await storedResolution(pool, inst.id, session.environment);
  if (known) return known;
  const d = await findMatch(session, inst);
  if (d.status === 'auto') return saveResolution(pool, session, inst, d.candidate, accountKey, 'auto');
  await recordIssue(pool, inst.id, session.environment, d.status, ISSUE_TEXT[d.status](inst.symbol), d.candidates);
  if (d.status === 'not_found') throw new AppError(422, 'SAXO_INSTRUMENT_NOT_FOUND', ISSUE_TEXT.not_found(inst.symbol));
  throw new AppError(409, 'SAXO_AMBIGUOUS', ISSUE_TEXT.ambiguous(inst.symbol), { candidates: d.candidates });
}

/**
 * Liga um instrumento do catálogo (sem correspondência) ou revalida um já ligado. Devolve o estado final:
 * 'linked' | 'rechecked' | 'ambiguous' | 'other_market' | 'not_found' | 'not_tradable' | 'error'.
 */
export async function syncInstrument(pool, session, inst, accountKey, { recheck = false } = {}) {
  const env = session.environment;
  const known = await storedResolution(pool, inst.id, env);
  try {
    if (known) {
      if (!recheck) return 'skipped';
      const d = await session.client.get(`/ref/v1/instruments/details/${Number(known.uic)}/Stock`, { AccountKey: accountKey });
      const ok = d && d.IsTradable !== false && (d.CurrencyCode ?? known.currency) === inst.currency;
      await pool.query('UPDATE saxo_instruments SET tradable = ?, checked_at = NOW(3) WHERE instrument_id = ? AND environment = ?', [ok ? 1 : 0, inst.id, env]);
      if (ok) { await clearIssue(pool, inst.id, env); return 'rechecked'; }
      await recordIssue(pool, inst.id, env, 'not_tradable', `${known.saxo_symbol} deixou de ser negociável na SAXO Bank (ou mudou de moeda)`);
      return 'not_tradable';
    }
    const d = await findMatch(session, inst);
    if (d.status === 'auto') {
      await saveResolution(pool, session, inst, d.candidate, accountKey, 'auto');
      return 'linked';
    }
    await recordIssue(pool, inst.id, env, d.status, ISSUE_TEXT[d.status](inst.symbol), d.candidates);
    return d.status;
  } catch (err) {
    // Token: pára a ligação toda. Limite de pedidos: quem chama espera e repete.
    if (['SAXO_TOKEN_EXPIRED', 'SAXO_NO_TOKEN', 'SAXO_RATE_LIMITED'].includes(err.code)) throw err;
    const status = err.code === 'SAXO_NOT_TRADABLE' || err.code === 'CURRENCY_MISMATCH' ? 'not_tradable' : 'error';
    await recordIssue(pool, inst.id, env, status, err.message);
    return status;
  }
}
