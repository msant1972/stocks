import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { audit, withTransaction } from '../db.js';
import { AppError } from '../errors.js';

// As mesmas regras do motor de recolha (engines/fetcher/fetcher/validation.py): aqui só se valida o
// formato do símbolo Yahoo; existência e moeda EUR são confirmadas pelo motor, de forma assíncrona.
export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-&^=]{0,31}$/;
export const MAX_IMPORT_ROWS = 1000;

export const normaliseSymbol = (raw) => String(raw ?? '').trim().toUpperCase();
export const symbolError = (symbol) => (SYMBOL_RE.test(symbol) ? null : 'símbolo vazio ou com formato inválido');

/**
 * Adiciona símbolos ao catálogo global. Um símbolo novo fica em 'pending' e gera um pedido de carga
 * inicial em fetch_jobs. Opcionalmente associa todos (novos e existentes) à lista do utilizador.
 */
export async function addSymbols(pool, userId, rawSymbols, addToWatchlist) {
  const results = [];
  const seen = new Set();
  await withTransaction(pool, async (conn) => {
    for (const raw of rawSymbols) {
      const symbol = normaliseSymbol(raw);
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      const err = symbolError(symbol);
      if (err) {
        results.push({ symbol, result: 'error', message: err, instrumentId: null });
        continue;
      }
      const [ins] = await conn.query('INSERT IGNORE INTO instruments (symbol) VALUES (?)', [symbol]);
      const created = ins.affectedRows === 1;
      const [[row]] = await conn.query('SELECT id, status FROM instruments WHERE symbol = ?', [symbol]);
      const id = Number(row.id);
      if (created) {
        await conn.query("INSERT INTO fetch_jobs (instrument_id, kind) VALUES (?, 'initial')", [id]);
        await audit(conn, userId, 'instrument.create', 'instrument', id, { symbol });
      }
      if (addToWatchlist && row.status !== 'invalid') {
        await conn.query('INSERT IGNORE INTO watchlist_items (user_id, instrument_id) VALUES (?, ?)', [userId, id]);
      }
      results.push({
        symbol,
        result: created ? 'created' : 'exists',
        message: created ? 'adicionado; a validar no fornecedor' : row.status === 'invalid' ? 'já existe e é inválido' : 'já existe no catálogo',
        instrumentId: id,
      });
    }
  });
  return results;
}

/**
 * Pede a validação imediata dos instrumentos «A validar»: os pedidos em fila deixam de esperar pela
 * próxima tentativa, os que falharam voltam à fila e os que não têm pedido recebem um. Devolve quantos
 * instrumentos ficaram na fila.
 */
export async function requestPendingFetch(pool, userId, instrumentIds = null) {
  return withTransaction(pool, async (conn) => {
    const filter = instrumentIds?.length ? ' AND i.id IN (?)' : '';
    const args = instrumentIds?.length ? [instrumentIds] : [];
    const [rows] = await conn.query(`SELECT i.id FROM instruments i WHERE i.status = 'pending'${filter} FOR UPDATE`, args);
    const ids = rows.map((r) => Number(r.id));
    if (!ids.length) return 0;
    await conn.query("UPDATE fetch_jobs SET next_attempt_at = NOW(3) WHERE status = 'queued' AND instrument_id IN (?)", [ids]);
    await conn.query(
      `UPDATE fetch_jobs SET status = 'queued', next_attempt_at = NOW(3), attempts = 0, finished_at = NULL
        WHERE status = 'failed' AND instrument_id IN (?)
          AND NOT EXISTS (SELECT 1 FROM (SELECT instrument_id FROM fetch_jobs WHERE status IN ('queued','running')) a
                           WHERE a.instrument_id = fetch_jobs.instrument_id)`,
      [ids],
    );
    await conn.query(
      `INSERT INTO fetch_jobs (instrument_id, kind)
       SELECT i.id, 'initial' FROM instruments i
        WHERE i.id IN (?) AND NOT EXISTS (SELECT 1 FROM fetch_jobs j WHERE j.instrument_id = i.id AND j.status IN ('queued','running'))`,
      [ids],
    );
    await audit(conn, userId, 'instrument.fetch_request', null, null, { count: ids.length });
    return ids.length;
  });
}

/** Sinaliza o motor de recolha para arrancar já. Devolve false se não houver sinal configurado ou falhar. */
export async function triggerFetcher(cfg, log) {
  if (!cfg.fetchTriggerFile) return false;
  try {
    await fs.writeFile(cfg.fetchTriggerFile, `${new Date().toISOString()}\n`);
    return true;
  } catch (err) {
    log?.warn({ err }, 'não foi possível sinalizar o motor de recolha');
    return false;
  }
}

/** Lê a coluna de símbolos de um .xlsx ou .csv. Devolve [{ line, raw }]. */
export async function readSymbolFile(filename, buffer) {
  const lower = filename.toLowerCase();
  let rows;
  if (lower.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer);
    } catch {
      throw new AppError(400, 'INVALID_FILE', 'não foi possível ler o ficheiro Excel');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new AppError(400, 'INVALID_FILE', 'o ficheiro não tem folhas');
    rows = [];
    ws.eachRow({ includeEmpty: false }, (row, number) => {
      rows.push({ line: number, cells: row.values.slice(1).map(cellText) });
    });
  } else if (lower.endsWith('.csv')) {
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    rows = text.split(/\r?\n/).map((l, i) => ({ line: i + 1, cells: l.split(/[;,]/).map((c) => c.trim().replace(/^"|"$/g, '')) }))
      .filter((r) => r.cells.some((c) => c));
  } else {
    throw new AppError(400, 'INVALID_FILE', 'formato não suportado; use .xlsx ou .csv');
  }
  if (rows.length === 0) throw new AppError(400, 'INVALID_FILE', 'o ficheiro está vazio');

  // A coluna "ticker" é obrigatória; sem cabeçalho reconhecido, usa-se a primeira coluna.
  const header = rows[0].cells.map((c) => c.toLowerCase());
  let col = header.findIndex((c) => c === 'ticker' || c === 'símbolo' || c === 'simbolo' || c === 'symbol');
  if (col >= 0) rows = rows.slice(1);
  else col = 0;
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new AppError(400, 'TOO_MANY_ROWS', `o ficheiro tem mais de ${MAX_IMPORT_ROWS} linhas`);
  }
  return rows.map((r) => ({ line: r.line, raw: r.cells[col] ?? '' }));
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') return String(v.text ?? v.result ?? v.richText?.map((t) => t.text).join('') ?? '');
  return String(v).trim();
}

/** Pré-visualização da importação: classifica cada linha sem gravar nada. */
export async function previewImport(pool, rows) {
  const symbols = rows.map((r) => normaliseSymbol(r.raw));
  const valid = symbols.filter((s) => !symbolError(s));
  const existing = new Map();
  if (valid.length) {
    const [found] = await pool.query('SELECT id, symbol, status FROM instruments WHERE symbol IN (?)', [valid]);
    for (const f of found) existing.set(f.symbol, f);
  }
  const seen = new Set();
  const out = rows.map((r, i) => {
    const symbol = symbols[i];
    const err = symbolError(symbol);
    if (err) return { line: r.line, symbol, status: 'error', message: err };
    if (seen.has(symbol)) return { line: r.line, symbol, status: 'duplicate', message: 'repetido no ficheiro' };
    seen.add(symbol);
    const ex = existing.get(symbol);
    if (ex) {
      return {
        line: r.line, symbol, status: 'exists',
        message: ex.status === 'invalid' ? 'já existe no catálogo e é inválido' : 'já existe no catálogo',
      };
    }
    return { line: r.line, symbol, status: 'new', message: 'será adicionado e validado no fornecedor' };
  });
  const count = (s) => out.filter((r) => r.status === s).length;
  return { rows: out, summary: { new: count('new'), exists: count('exists'), duplicate: count('duplicate'), error: count('error') } };
}

/** Modelo .xlsx para importação. Só a coluna ticker é lida; o resto vem do fornecedor. */
export async function importTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Instrumentos');
  ws.columns = [
    { header: 'ticker', key: 'ticker', width: 16 },
    { header: 'nome', key: 'nome', width: 32 },
    { header: 'notas', key: 'notas', width: 48 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow({ ticker: 'GALP.LS', nome: 'Galp Energia', notas: 'Símbolo Yahoo, com o sufixo do mercado' });
  ws.addRow({ ticker: 'SIE.DE', nome: 'Siemens', notas: 'Só são aceites instrumentos cotados em EUR' });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
