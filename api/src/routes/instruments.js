import { z } from 'zod';
import { AppError, notFound } from '../errors.js';
import { Decimal, ErrorBody, Id, InstrumentStatus, InstrumentSummary, IsoDate, NullableDecimal } from '../schemas.js';
import { addSymbols, importTemplate, previewImport, readSymbolFile, requestPendingFetch, setIsinMic, triggerFetcher } from '../services/instruments.js';
import {
  computeStats, EncryptedResponseError, fetchOrderBook, InstrumentNotFoundError, SOURCE_NOTE, suggestMic, toJson,
  UnexpectedFormatError, UpstreamError,
} from '../orderbook/index.js';
import { latestQuotes } from '../services/quotes.js';

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
  };
}

export const INSTRUMENT_SELECT = `
  SELECT i.id, i.symbol, i.name, i.exchange, i.currency, i.status, i.status_reason, i.first_session, i.last_session, i.isin, i.mic,
         EXISTS (SELECT 1 FROM watchlist_items w WHERE w.instrument_id = i.id AND w.user_id = ?) AS in_watchlist
    FROM instruments i`;

const MAX_QUOTE_ROWS = 1500;

/** 'AAAA-MM-DD' recuado n anos; 29 de Fevereiro passa a 28. */
function yearsBefore(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y - n, m - 1, d));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
}

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
      }),
      response: { 200: z.object({ items: z.array(InstrumentSummary), total: z.number() }) },
    },
  }, async (req) => {
    const { q, status, withIsinMic, limit, offset } = req.query;
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
    const [rows] = await pool.query(
      `${INSTRUMENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.symbol LIMIT ? OFFSET ?`,
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

  app.get('/instruments/:id', {
    schema: {
      tags: ['Instrumentos'], summary: 'Detalhe do instrumento e estado da recolha',
      params: z.object({ id: Id }),
      response: {
        200: InstrumentSummary.extend({
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
    return {
      ...mapInstrument(r, quotes),
      sessions: Number(sessions),
      fetch: job ? { status: job.status, kind: job.kind, lastError: job.last_error, finishedAt: job.finished_at?.toISOString() ?? null } : null,
    };
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
