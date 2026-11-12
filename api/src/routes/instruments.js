import { z } from 'zod';
import { AppError, notFound } from '../errors.js';
import { Decimal, ErrorBody, Id, InstrumentStatus, InstrumentSummary, IsoDate, NullableDecimal } from '../schemas.js';
import {
  addSymbols, deleteInstrument, importTemplate, previewImport, readSymbolFile, requestPendingFetch, setIsinMic, triggerFetcher,
} from '../services/instruments.js';
import {
  computeStats, EncryptedResponseError, fetchOrderBook, InstrumentNotFoundError, SOURCE_NOTE, suggestMic, toJson,
  UnexpectedFormatError, UpstreamError,
} from '../orderbook/index.js';
import { latestQuotes } from '../services/quotes.js';
import { annualEps, liveProfile, parseFinancials, valuation } from '../valuation.js';
import { allValuations } from '../services/valuations.js';

export function mapInstrument(r, quotes) {
  const id = Number(r.id);
  return {
    id, symbol: r.symbol, name: r.name, exchange: r.exchange, currency: r.currency,
    status: r.status, statusReason: r.status_reason,
    firstSession: r.first_session, lastSession: r.last_session,
    inWatchlist: Boolean(r.in_watchlist),
    isinMic: r.isin && r.mic ? `${r.isin}-${r.mic}` : null,
    suggestedMic: suggestMic(r.exchange),
    latest: quotes.get(id) ?? null,
    // Na lista, para o logotipo aparecer logo (sem esperar pelo detalhe do instrumento).
    logoVersion: r.logo_at ? new Date(r.logo_at).getTime() : null,
  };
}

export const INSTRUMENT_SELECT = `
  SELECT i.id, i.symbol, i.name, i.exchange, i.currency, i.status, i.status_reason, i.first_session, i.last_session, i.isin, i.mic,
         EXISTS (SELECT 1 FROM watchlist_items w WHERE w.instrument_id = i.id AND w.user_id = ?) AS in_watchlist,
         (SELECT lg.updated_at FROM instrument_logos lg WHERE lg.instrument_id = i.id AND lg.status = 'ok') AS logo_at
    FROM instruments i`;


const num = (v) => (v == null ? null : Number(v));

export function mapProfile(r) {
  return {
    longName: r.long_name, summary: r.summary, sector: r.sector, industry: r.industry, country: r.country, city: r.city,
    website: r.website && /^https?:\/\//.test(r.website) ? r.website : null, employees: r.employees == null ? null : Number(r.employees),
    currency: r.currency, financialCurrency: r.financial_currency,
    marketCap: num(r.market_cap), trailingPe: num(r.trailing_pe), forwardPe: num(r.forward_pe), priceToBook: num(r.price_to_book),
    dividendYield: num(r.dividend_yield), beta: num(r.beta), eps: num(r.eps), profitMargin: num(r.profit_margin),
    returnOnEquity: num(r.return_on_equity), debtToEquity: num(r.debt_to_equity), high52w: num(r.high_52w), low52w: num(r.low_52w),
    financials: parseFinancials(r.financials),
  };
}

const N = z.number().nullable();
const CompanyProfileResponse = z.object({
  profile: z.object({
    longName: z.string().nullable(), summary: z.string().nullable(), sector: z.string().nullable(), industry: z.string().nullable(),
    country: z.string().nullable(), city: z.string().nullable(), website: z.string().nullable(), employees: N,
    currency: z.string().nullable(), financialCurrency: z.string().nullable(),
    marketCap: N, trailingPe: N, forwardPe: N, priceToBook: N, dividendYield: N, beta: N, eps: N, profitMargin: N,
    returnOnEquity: N, debtToEquity: N, high52w: N, low52w: N,
    live: z.object({
      repriced: z.boolean(), price: N, priceDate: z.string().nullable(),
      marketCap: N, trailingPe: N, forwardPe: N, priceToBook: N, dividendYield: N, low52w: N, high52w: N,
      trailingEps: N, forwardEps: N, forwardYear: N,
    }),
    financials: z.array(z.object({
      year: z.number(), revenue: N, operatingIncome: N, netIncome: N, ebitda: N, dilutedEps: N, freeCashFlow: N, equity: N, shares: N,
    })),
  }).nullable(),
  fetchedAt: z.string().nullable(),
  source: z.string(),
});

const Verdict = z.enum(['cheap', 'fair', 'expensive']).nullable();
const ValuationResponse = z.object({
  valuation: z.object({
    price: N, priceDate: z.string().nullable(), currency: z.string().nullable(),
    summary: z.object({ verdict: z.enum(['cheap', 'fair', 'expensive', 'insufficient']), cheap: z.number(), expensive: z.number(), fair: z.number(), total: z.number() }),
    sector: z.object({
      sector: z.string().nullable(), peers: z.number(), score: N, verdict: Verdict,
      metrics: z.array(z.object({
        key: z.string(), label: z.string(), cheapWhen: z.enum(['low', 'high']), value: z.number(), sectorMedian: z.number(),
        cheapness: z.number(), peers: z.number(),
      })),
    }),
    history: z.object({
      verdict: Verdict, current: N, eps: N.optional(), epsYear: N.optional(), median: N, p25: N, p75: N, points: z.number(), from: z.string().optional(), reason: z.string().optional(),
      series: z.array(z.object({ date: z.string(), pe: z.number() })),
    }),
    analysts: z.object({
      count: z.number(), mean: N, median: N, low: N, high: N, recommendation: z.string().nullable(), recommendationMean: N,
      upside: N, verdict: Verdict,
    }),
    graham: z.object({ value: N, eps: N, bookValue: N, ratio: N, verdict: Verdict }),
    dcf: z.object({
      impliedGrowth: N, bound: z.enum(['below', 'above']).nullable().optional(), revenueCagr: N,
      assumptions: z.object({ discount: z.number(), terminal: z.number(), years: z.number() }),
    }),
    metrics: z.object({ pe: N, pb: N, evEbitda: N, dividendYield: N, fcfYield: N }),
    trailingEps: N,
  }).nullable(),
  fetchedAt: z.string().nullable(),
  source: z.string(),
});

const ValuationRow = z.object({
  instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), exchange: z.string().nullable(), sector: z.string().nullable(),
  price: N, priceDate: z.string().nullable(), currency: z.string().nullable(),
  verdict: z.enum(['cheap', 'fair', 'expensive', 'insufficient']), cheap: z.number(), expensive: z.number(), total: z.number(),
  criteria: z.object({ sector: Verdict, history: Verdict, analysts: Verdict, graham: Verdict }),
  pe: N, sectorPe: N, sectorScore: N, dividendYield: N, upside: N, analysts: z.number(), grahamGap: N,
});

const MAX_QUOTE_ROWS = 1500;

import { yearsBefore } from '../dates.js';

export { yearsBefore };

export default async function instrumentRoutes(app, { pool, cfg }) {
  app.get('/instruments', {
    schema: {
      tags: ['Instrumentos'], summary: 'Pesquisar no catálogo global',
      querystring: z.object({
        q: z.string().max(64).optional().describe('Texto no símbolo ou na designação'),
        status: InstrumentStatus.optional(),
        withIsinMic: z.enum(['true', 'false']).optional().describe('Só instrumentos com ISIN-MIC (livro de ofertas)'),
        limit: z.coerce.number().int().min(1).max(500).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sort: z.enum(['symbol', 'volume', 'turnover', 'change']).default('symbol')
          .describe('symbol, volume, turnover (VT: último fecho × volume) ou change (variação da última sessão); sem valor ficam no fim'),
        dir: z.enum(['asc', 'desc']).optional().describe('por omissão asc para symbol e desc para os restantes'),
      }),
      response: { 200: z.object({ items: z.array(InstrumentSummary), total: z.number() }) },
    },
  }, async (req) => {
    const { q, status, withIsinMic, limit, offset, sort } = req.query;
    const dir = (req.query.dir ?? (sort === 'symbol' ? 'asc' : 'desc')).toUpperCase();
    const where = ['1 = 1'];
    const args = [];
    if (q) {
      where.push('(i.symbol LIKE ? OR i.name LIKE ?)');
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      args.push(like, like);
    }
    if (status) { where.push('i.status = ?'); args.push(status); }
    if (withIsinMic === 'true') where.push('i.isin IS NOT NULL AND i.mic IS NOT NULL');
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM instruments i WHERE ${where.join(' AND ')}`, args);
    // Ordenação sobre todo o catálogo (não só a página): última sessão e a anterior de cada instrumento.
    const QUOTE_JOINS = ` LEFT JOIN daily_quotes lq ON lq.instrument_id = i.id AND lq.session_date = i.last_session
      LEFT JOIN daily_quotes pq ON pq.instrument_id = i.id AND pq.session_date =
        (SELECT MAX(p.session_date) FROM daily_quotes p WHERE p.instrument_id = i.id AND p.session_date < i.last_session)`;
    const expr = { symbol: 'i.symbol', volume: 'lq.volume', turnover: 'lq.close * lq.volume', change: 'lq.close / NULLIF(pq.close, 0)' }[sort];
    const [rows] = await pool.query(
      `${INSTRUMENT_SELECT}${sort === 'symbol' ? '' : QUOTE_JOINS} WHERE ${where.join(' AND ')}
        ORDER BY (${expr}) IS NULL, ${expr} ${dir}, i.symbol LIMIT ? OFFSET ?`,
      [req.user.id, ...args, limit, offset],
    );
    const quotes = await latestQuotes(pool, rows.map((r) => r.id));
    return { items: rows.map((r) => mapInstrument(r, quotes)), total: Number(total) };
  });

  app.post('/instruments', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['Instrumentos'], summary: 'Adicionar símbolos ao catálogo (validação assíncrona no fornecedor)',
      body: z.object({
        symbols: z.array(z.string().max(64)).min(1).max(1000),
        addToWatchlist: z.boolean().default(true),
        isinMics: z.record(z.string(), z.string().max(32)).optional().describe('ISIN-MIC por símbolo, ex.: { "GALP.LS": "PTGAL0AM0009-XLIS" }'),
      }),
      response: {
        200: z.object({
          results: z.array(z.object({
            symbol: z.string(), result: z.enum(['created', 'exists', 'error']),
            message: z.string(), instrumentId: z.number().nullable(),
          })),
        }),
      },
    },
  }, async (req) => {
    const results = await addSymbols(pool, req.user.id, req.body.symbols, req.body.addToWatchlist, req.body.isinMics);
    if (results.some((r) => r.result === 'created')) await triggerFetcher(cfg, req.log);
    return { results };
  });

  app.post('/instruments/fetch', {
    config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    schema: {
      tags: ['Instrumentos'],
      summary: 'Forçar a validação no fornecedor dos instrumentos «A validar»',
      description: 'Põe os instrumentos pendentes (todos, ou os indicados) na fila sem espera e arranca o motor de recolha. '
        + 'A validação é assíncrona: o estado de cada instrumento muda quando o motor o processar.',
      body: z.object({ instrumentIds: z.array(Id).max(1000).optional() }),
      response: { 202: z.object({ queued: z.number(), started: z.boolean() }) },
    },
  }, async (req, reply) => {
    const queued = await requestPendingFetch(pool, req.user.id, req.body.instrumentIds);
    const started = queued > 0 && (await triggerFetcher(cfg, req.log));
    return reply.code(202).send({ queued, started });
  });

  app.post('/instruments/import/preview', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['Instrumentos'],
      summary: 'Pré-visualizar importação de .xlsx ou .csv (multipart, campo "file"); não grava nada',
      consumes: ['multipart/form-data'],
      response: {
        200: z.object({
          rows: z.array(z.object({
            line: z.number(), symbol: z.string(), isinMic: z.string().nullable(),
            status: z.enum(['new', 'exists', 'duplicate', 'error']), message: z.string(),
          })),
          summary: z.object({ new: z.number(), exists: z.number(), duplicate: z.number(), error: z.number() }),
        }),
        400: ErrorBody,
      },
    },
  }, async (req) => {
    if (!req.isMultipart()) throw new AppError(400, 'INVALID_FILE', 'envie o ficheiro em multipart/form-data');
    const file = await req.file();
    if (!file) throw new AppError(400, 'INVALID_FILE', 'nenhum ficheiro recebido');
    const buffer = await file.toBuffer();
    const rows = await readSymbolFile(file.filename, buffer);
    return previewImport(pool, rows);
  });

  app.get('/instruments/import/template', {
    schema: { tags: ['Instrumentos'], summary: 'Modelo .xlsx para importação' },
  }, async (req, reply) => {
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', 'attachment; filename="modelo-instrumentos.xlsx"');
    return importTemplate();
  });

  app.get('/instruments/:id/profile', {
    schema: {
      tags: ['Instrumentos'], summary: 'Perfil da empresa (actividade, indicadores e contas anuais; fonte: Yahoo)',
      description: 'Recolhido pelo motor de recolha uma vez por semana e na carga inicial. `profile` é null enquanto não houver dados. '
        + 'dividendYield e debtToEquity vêm em percentagem; profitMargin e returnOnEquity em fracção. Os campos de topo são os da recolha; '
        + '`live` dá a capitalização, os P/E, o P/VC e o dividendo ao último preço, o intervalo de 52 semanas alargado até ele, os resultados '
        + 'por acção de cada P/E e o ano fiscal da estimativa.',
      params: z.object({ id: Id }),
      response: { 200: CompanyProfileResponse, 404: ErrorBody },
    },
  }, async (req) => {
    const [[inst]] = await pool.query('SELECT id FROM instruments WHERE id = ?', [req.params.id]);
    if (!inst) throw notFound('Instrumento');
    const [[r]] = await pool.query('SELECT * FROM company_profiles WHERE instrument_id = ?', [req.params.id]);
    if (!r || r.status !== 'ok' || !r.fetched_at) return { profile: null, fetchedAt: r?.fetched_at?.toISOString() ?? null, source: 'Yahoo Finance' };
    const latest = (await latestQuotes(pool, [Number(req.params.id)])).get(Number(req.params.id));
    const [[range]] = await pool.query(
      `SELECT MIN(COALESCE(low, close)) AS low, MAX(COALESCE(high, close)) AS high
         FROM daily_quotes WHERE instrument_id = ? AND session_date >= DATE(?)`, [req.params.id, r.fetched_at],
    );
    const profile = mapProfile(r);
    return {
      profile: { ...profile, live: liveProfile(r, latest?.close, latest?.date, profile.financials, range) },
      fetchedAt: r.fetched_at.toISOString(), source: 'Yahoo Finance',
    };
  });

  app.get('/valuations', {
    schema: {
      tags: ['Instrumentos'], summary: 'Valorização indicativa de todos os instrumentos activos com perfil (página «Pechinchas»)',
      description: 'Mesmas regras de /instruments/{id}/valuation, resumidas por instrumento. `verdict` filtra pelo veredicto global. '
        + 'upside e grahamGap em fracção; dividendYield em percentagem.',
      querystring: z.object({ verdict: z.enum(['cheap', 'fair', 'expensive', 'insufficient']).optional() }),
      response: { 200: z.object({ items: z.array(ValuationRow), source: z.string() }) },
    },
  }, async (req) => {
    const rows = await allValuations(pool);
    return { items: req.query.verdict ? rows.filter((r) => r.verdict === req.query.verdict) : rows, source: 'Yahoo Finance' };
  });

  app.get('/instruments/:id/valuation', {
    schema: {
      tags: ['Instrumentos'], summary: 'Valorização indicativa (sector, história do P/E, analistas, Graham, DCF invertido)',
      description: 'Calculada a pedido com o último fecho e o perfil semanal do Yahoo. `valuation` é null sem perfil ou sem cotações. '
        + 'Rendimentos (dividendYield, fcfYield) em percentagem; upside, impliedGrowth e revenueCagr em fracção. Indicativo, não é uma recomendação.',
      params: z.object({ id: Id }),
      response: { 200: ValuationResponse, 404: ErrorBody },
    },
  }, async (req) => {
    const id = Number(req.params.id);
    const [[inst]] = await pool.query('SELECT id FROM instruments WHERE id = ?', [id]);
    if (!inst) throw notFound('Instrumento');
    const [[row]] = await pool.query("SELECT * FROM company_profiles WHERE instrument_id = ? AND status = 'ok' AND fetched_at IS NOT NULL", [id]);
    const latest = (await latestQuotes(pool, [id])).get(id);
    const meta = { fetchedAt: row?.fetched_at?.toISOString() ?? null, source: 'Yahoo Finance' };
    if (!row || !latest) return { valuation: null, ...meta };
    const financials = parseFinancials(row.financials);
    const [peerRows] = row.sector ? await pool.query(
      `SELECT p.* FROM company_profiles p JOIN instruments i ON i.id = p.instrument_id
        WHERE p.sector = ? AND p.status = 'ok' AND p.fetched_at IS NOT NULL AND i.status = 'active' AND p.instrument_id <> ?`,
      [row.sector, id],
    ) : [[]];
    const peerQuotes = await latestQuotes(pool, peerRows.map((r) => r.instrument_id));
    const peers = peerRows.filter((r) => peerQuotes.has(Number(r.instrument_id)))
      .map((r) => ({ row: r, close: peerQuotes.get(Number(r.instrument_id)).close }));
    const firstYear = financials.find((f) => annualEps(f) != null)?.year;
    const [closes] = firstYear ? await pool.query(
      'SELECT session_date AS date, close FROM daily_quotes WHERE instrument_id = ? AND session_date >= ? ORDER BY session_date',
      [id, `${firstYear + 1}-04-01`],
    ) : [[]];
    return {
      valuation: valuation({ row, close: latest.close, closeDate: latest.date, financials, closes, peers }),
      ...meta,
    };
  });

  app.get('/instruments/:id', {
    schema: {
      tags: ['Instrumentos'], summary: 'Detalhe do instrumento e estado da recolha',
      params: z.object({ id: Id }),
      response: {
        200: InstrumentSummary.extend({
          website: z.string().nullable().describe('Site da empresa (Yahoo)'),
          sessions: z.number(),
          fetch: z.object({
            status: z.enum(['queued', 'running', 'done', 'failed']), kind: z.enum(['initial', 'incremental']),
            lastError: z.string().nullable(), finishedAt: z.string().nullable(),
          }).nullable(),
        }),
        404: ErrorBody,
      },
    },
  }, async (req) => {
    const [[r]] = await pool.query(`${INSTRUMENT_SELECT} WHERE i.id = ?`, [req.user.id, req.params.id]);
    if (!r) throw notFound('Instrumento');
    const [[{ sessions }]] = await pool.query('SELECT COUNT(*) AS sessions FROM daily_quotes WHERE instrument_id = ?', [r.id]);
    const [[job]] = await pool.query(
      'SELECT status, kind, last_error, finished_at FROM fetch_jobs WHERE instrument_id = ? ORDER BY id DESC LIMIT 1',
      [r.id],
    );
    const quotes = await latestQuotes(pool, [r.id]);
    const [[prof]] = await pool.query('SELECT website FROM company_profiles WHERE instrument_id = ?', [r.id]);
    return {
      ...mapInstrument(r, quotes),
      website: prof?.website && /^https?:\/\//.test(prof.website) ? prof.website : null,
      sessions: Number(sessions),
      fetch: job ? { status: job.status, kind: job.kind, lastError: job.last_error, finishedAt: job.finished_at?.toISOString() ?? null } : null,
    };
  });

  app.delete('/instruments/:id', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['Instrumentos'], summary: 'Apagar um instrumento do catálogo (administradores)',
      description: 'Apaga o instrumento e as suas cotações, pedidos de recolha, entradas nas listas de acompanhamento e regras '
        + 'de alerta de todos os utilizadores. Recusado (409 INSTRUMENT_IN_USE) se houver ordens enviadas à SAXO Bank.',
      params: z.object({ id: Id }),
      response: {
        200: z.object({ symbol: z.string(), watchlists: z.number(), alertRules: z.number(), quotes: z.number() }),
        403: ErrorBody, 404: ErrorBody, 409: ErrorBody,
      },
    },
  }, async (req) => {
    if (!req.user.isAdmin) throw new AppError(403, 'FORBIDDEN', 'reservado a administradores');
    return deleteInstrument(pool, req.user.id, req.params.id);
  });

  app.put('/instruments/:id/isin-mic', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['Instrumentos'], summary: 'Definir ou apagar o ISIN-MIC de um instrumento do catálogo',
      params: z.object({ id: Id }),
      body: z.object({ isinMic: z.string().max(32).nullable().describe('ex.: PTFCP0AM0008-XLIS; null ou vazio apaga') }),
      response: { 200: z.object({ isinMic: z.string().nullable() }), 400: ErrorBody, 404: ErrorBody },
    },
  }, async (req) => ({ isinMic: await setIsinMic(pool, req.user.id, req.params.id, req.body.isinMic?.trim() || null) }));

  // Resumo do livro (mid e desequilíbrio) para as listas, pedido pelo browser em lotes de 50. O limite de
  // 4 pedidos simultâneos à Euronext é global (partilhado por todos os lotes e utilizadores), e usa-se a
  // mesma cache de 30 s por instrumento do livro completo; os instrumentos sem ISIN-MIC são ignorados.
  const SUMMARY_CONCURRENCY = 4;
  let active = 0;
  const waiting = [];
  const withSlot = async (fn) => {
    if (active >= SUMMARY_CONCURRENCY) await new Promise((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
  app.get('/instruments/orderbook-summary', {
    schema: {
      tags: ['Livro de ofertas'], summary: 'Mid e desequilíbrio do livro de vários instrumentos (atraso 15 min)',
      description: 'ids separados por vírgulas (até 50). error: NOT_FOUND, UPSTREAM ou FORMAT quando o livro não pôde ser obtido.',
      querystring: z.object({ ids: z.string().regex(/^\d+(,\d+)*$/).max(600) }),
      response: {
        200: z.object({
          items: z.array(z.object({
            id: z.number(), mid: NullableDecimal, imbalance: z.number().nullable(), crossed: z.boolean(),
            updatedAt: z.string().nullable(), error: z.enum(['NOT_FOUND', 'UPSTREAM', 'FORMAT']).nullable(),
          })),
        }),
        400: ErrorBody,
      },
    },
  }, async (req) => {
    const ids = [...new Set(req.query.ids.split(',').map(Number))];
    if (ids.length > 50) throw new AppError(400, 'TOO_MANY_IDS', 'no máximo 50 instrumentos por pedido');
    const [rows] = await pool.query('SELECT id, isin, mic FROM instruments WHERE id IN (?) AND isin IS NOT NULL AND mic IS NOT NULL', [ids]);
    const items = await Promise.all(rows.map((r) => withSlot(async () => {
      const item = { id: Number(r.id), mid: null, imbalance: null, crossed: false, updatedAt: null, error: null };
      try {
        const book = await fetchOrderBook(r.isin, r.mic, { logger: req.log });
        const stats = computeStats(book);
        Object.assign(item, { mid: stats.mid, imbalance: stats.imbalance, crossed: stats.crossed, updatedAt: book.updatedAt?.toISOString() ?? null });
      } catch (err) {
        item.error = err instanceof InstrumentNotFoundError ? 'NOT_FOUND' : err instanceof UpstreamError ? 'UPSTREAM' : 'FORMAT';
        if (item.error === 'FORMAT') req.log.warn({ err, isin: r.isin, mic: r.mic }, 'orderbook: resumo falhou');
      }
      return item;
    })));
    return { items };
  });

  const ObLevel = z.object({ side: z.enum(['bid', 'ask']), price: Decimal, quantity: z.number(), orders: z.number().nullable() });
  app.get('/instruments/:id/orderbook', {
    schema: {
      tags: ['Livro de ofertas'], summary: 'Livro de ofertas Euronext do instrumento (atraso 15 min)',
      description: 'Obtido de live.euronext.com pelo módulo euronext-orderbook (docs/arquitectura/orderbook-spec.md), '
        + 'com cache de 30 s por instrumento. Requer ISIN-MIC no catálogo. spreadPct e imbalance são frações.',
      params: z.object({ id: Id }),
      response: {
        200: z.object({
          instrument: z.object({ id: z.number(), symbol: z.string(), name: z.string().nullable(), isinMic: z.string() }),
          book: z.object({
            isin: z.string(), mic: z.string(), bids: z.array(ObLevel), asks: z.array(ObLevel),
            updatedAt: z.string().nullable(), fetchedAt: z.string(), delayMinutes: z.number(), source: z.string(),
          }),
          stats: z.object({
            bestBid: NullableDecimal, bestAsk: NullableDecimal, spread: NullableDecimal, spreadPct: z.number().nullable(),
            mid: NullableDecimal, bidVolume: z.number(), askVolume: z.number(), bidNotional: Decimal, askNotional: Decimal,
            imbalance: z.number().nullable(), bidOrders: z.number().nullable(), askOrders: z.number().nullable(), crossed: z.boolean(),
          }),
          sourceNote: z.string(),
        }),
        404: ErrorBody, 409: ErrorBody, 502: ErrorBody,
      },
    },
  }, async (req) => {
    const [[inst]] = await pool.query('SELECT id, symbol, name, isin, mic FROM instruments WHERE id = ?', [req.params.id]);
    if (!inst) throw notFound('Instrumento');
    if (!inst.isin || !inst.mic) {
      throw new AppError(409, 'NO_ISIN_MIC', 'o instrumento não tem ISIN-MIC; defina-o no catálogo, em Acompanhar');
    }
    let book;
    try {
      book = await fetchOrderBook(inst.isin, inst.mic, { logger: req.log });
    } catch (err) {
      if (err instanceof InstrumentNotFoundError) throw new AppError(404, 'ORDERBOOK_NOT_FOUND', 'a Euronext não tem livro de ofertas para este ISIN-MIC');
      if (err instanceof UpstreamError) throw new AppError(502, 'ORDERBOOK_UPSTREAM', `a Euronext não respondeu: ${err.message}`);
      if (err instanceof UnexpectedFormatError || err instanceof EncryptedResponseError) {
        throw new AppError(502, 'ORDERBOOK_FORMAT', 'a resposta da Euronext veio num formato inesperado');
      }
      throw err;
    }
    return {
      instrument: { id: Number(inst.id), symbol: inst.symbol, name: inst.name, isinMic: `${inst.isin}-${inst.mic}` },
      ...toJson(book, computeStats(book)),
      sourceNote: SOURCE_NOTE,
    };
  });

  app.get('/instruments/:id/quotes', {
    schema: {
      tags: ['Histórico'], summary: 'Cotações diárias e indicadores técnicos (por omissão, os últimos dois anos)',
      description: 'ema9, sma10, sma50, sma125 e sma200 são calculados sobre o fecho ajustado com todo o histórico '
        + 'disponível; são null enquanto não houver sessões suficientes.',
      params: z.object({ id: Id }),
      querystring: z.object({ from: IsoDate.optional(), to: IsoDate.optional() }),
      response: {
        200: z.object({
          instrumentId: z.number(), symbol: z.string(), currency: z.string().nullable(),
          firstSession: IsoDate.nullable(), lastSession: IsoDate.nullable(),
          quotes: z.array(z.object({
            date: IsoDate, open: NullableDecimal, high: NullableDecimal, low: NullableDecimal,
            close: Decimal, adjClose: NullableDecimal, volume: z.number().nullable(),
            ema9: NullableDecimal, sma10: NullableDecimal, sma50: NullableDecimal, sma125: NullableDecimal, sma200: NullableDecimal,
          })),
          truncated: z.boolean(),
        }),
        404: ErrorBody,
      },
    },
  }, async (req) => {
    const [[inst]] = await pool.query('SELECT id, symbol, currency, first_session, last_session FROM instruments WHERE id = ?', [req.params.id]);
    if (!inst) throw notFound('Instrumento');
    const to = req.query.to ?? inst.last_session ?? new Date().toISOString().slice(0, 10);
    const from = req.query.from ?? yearsBefore(to, 2);
    const [rows] = await pool.query(
      `SELECT session_date, open, high, low, close, adj_close, volume, ema9, sma10, sma50, sma125, sma200 FROM daily_quotes
        WHERE instrument_id = ? AND session_date BETWEEN ? AND ?
        ORDER BY session_date DESC LIMIT ?`,
      [inst.id, from, to, MAX_QUOTE_ROWS + 1],
    );
    const truncated = rows.length > MAX_QUOTE_ROWS;
    return {
      instrumentId: Number(inst.id), symbol: inst.symbol, currency: inst.currency,
      firstSession: inst.first_session, lastSession: inst.last_session,
      quotes: rows.slice(0, MAX_QUOTE_ROWS).reverse().map((q) => ({
        date: q.session_date, open: q.open, high: q.high, low: q.low, close: q.close,
        adjClose: q.adj_close, volume: q.volume == null ? null : Number(q.volume),
        ema9: q.ema9, sma10: q.sma10, sma50: q.sma50, sma125: q.sma125, sma200: q.sma200,
      })),
      truncated,
    };
  });
}
