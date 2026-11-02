import ExcelJS from 'exceljs';
import { audit, withTransaction } from '../db.js';
import { parseIsinMic } from '../orderbook/instrument.js';

/** Mercado da lista Euronext → MIC e sufixo do símbolo Yahoo. */
export const MARKETS = {
  'Euronext Lisbon': { mic: 'XLIS', suffix: '.LS' },
  'Euronext Paris': { mic: 'XPAR', suffix: '.PA' },
  'Euronext Amsterdam': { mic: 'XAMS', suffix: '.AS' },
  'Euronext Brussels': { mic: 'XBRU', suffix: '.BR' },
  'Euronext Milan': { mic: 'MTAA', suffix: '.MI' },
  'Euronext Dublin': { mic: 'XMSM', suffix: '.IR' },
};

/**
 * Lê a lista oficial (colunas Name, ISIN, Symbol, Market). Devolve { rows, rejected }: linhas de mercados
 * desconhecidos ou com ISIN inválido (dígito de controlo) ficam em rejected, com o motivo.
 */
export async function readIsinFile(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const rows = [];
  const rejected = [];
  wb.worksheets[0].eachRow((row, n) => {
    if (n === 1) return;
    const [name, isin, symbol, market] = row.values.slice(1).map((v) => String(v ?? '').trim());
    const m = MARKETS[market];
    const parsed = m && parseIsinMic(`${isin}-${m.mic}`);
    if (!m) rejected.push({ line: n, symbol, reason: `mercado desconhecido: ${market}` });
    else if (!parsed) rejected.push({ line: n, symbol, reason: `ISIN inválido: ${isin}` });
    else rows.push({ isin: parsed.isin, mic: parsed.mic, symbol: symbol.toUpperCase(), yahooSymbol: `${symbol.toUpperCase()}${m.suffix}`, name: name || null, market });
  });
  return { rows, rejected };
}

/** Substitui o conteúdo de euronext_isins pelas linhas dadas, numa só transacção. */
export async function replaceEuronextIsins(pool, rows) {
  await withTransaction(pool, async (conn) => {
    await conn.query('DELETE FROM euronext_isins');
    if (rows.length) {
      await conn.query(
        'INSERT INTO euronext_isins (isin, mic, symbol, yahoo_symbol, name, market) VALUES ?',
        [rows.map((r) => [r.isin, r.mic, r.symbol, r.yahooSymbol, r.name, r.market])],
      );
    }
  });
}

/**
 * Preenche o ISIN-MIC dos instrumentos do catálogo que não o têm, a partir de euronext_isins (o símbolo Yahoo
 * tem de coincidir). A mesma regra é aplicada pelo motor de recolha a cada instrumento novo que valida
 * (engines/fetcher/fetcher/db.py, fill_isin_mic). Devolve os instrumentos preenchidos.
 */
export async function fillMissingIsinMics(pool, { apply = true } = {}) {
  return withTransaction(pool, async (conn) => {
    const [found] = await conn.query(
      `SELECT i.id, i.symbol, e.isin, e.mic, e.name
         FROM instruments i JOIN euronext_isins e ON e.yahoo_symbol = i.symbol
        WHERE i.isin IS NULL OR i.mic IS NULL
        ORDER BY i.symbol FOR UPDATE`,
    );
    if (apply) {
      for (const f of found) {
        await conn.query('UPDATE instruments SET isin = ?, mic = ? WHERE id = ?', [f.isin, f.mic, f.id]);
        await audit(conn, null, 'instrument.isin_mic', 'instrument', f.id, { symbol: f.symbol, isinMic: `${f.isin}-${f.mic}`, source: 'euronext_isins' });
      }
    }
    return found.map((f) => ({ id: Number(f.id), symbol: f.symbol, isinMic: `${f.isin}-${f.mic}`, name: f.name }));
  });
}
