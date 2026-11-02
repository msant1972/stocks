/**
 * Preenche o ISIN-MIC dos instrumentos do catálogo que ainda não o têm, a partir da lista oficial da Euronext
 * (ISIN.xlsx na raiz do repositório: colunas Name, ISIN, Symbol, Market).
 *
 * Correspondência: o sufixo do símbolo Yahoo dá o mercado (GALP.LS → Euronext Lisbon, MIC XLIS) e o resto do
 * símbolo tem de ser igual à coluna Symbol desse mercado. Só se grava quando há exactamente uma linha e o ISIN tem
 * dígito de controlo válido. Os instrumentos fora da Euronext (.DE, .MC, .HE, …) não têm livro e são ignorados.
 * Sem --apply só mostra o que faria.
 *
 *   cd api && node --env-file=../.env ../scripts/isin-mic-from-xlsx.mjs [--apply] [ficheiro.xlsx]
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createPool, audit, withTransaction } from '../api/src/db.js';
import { loadConfig } from '../api/src/config.js';
import { parseIsinMic } from '../api/src/orderbook/instrument.js';

const ExcelJS = createRequire(new URL('../api/package.json', import.meta.url))('exceljs');

const MARKETS = {
  LS: ['Euronext Lisbon', 'XLIS'], PA: ['Euronext Paris', 'XPAR'], AS: ['Euronext Amsterdam', 'XAMS'],
  BR: ['Euronext Brussels', 'XBRU'], MI: ['Euronext Milan', 'MTAA'], IR: ['Euronext Dublin', 'XMSM'],
};

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--')) ?? fileURLToPath(new URL('../ISIN.xlsx', import.meta.url));

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const byKey = new Map(); // "Euronext Paris|MC" → [{ name, isin }]
wb.worksheets[0].eachRow((row, n) => {
  if (n === 1) return;
  const [name, isin, symbol, market] = row.values.slice(1).map((v) => String(v ?? '').trim());
  const key = `${market}|${symbol.toUpperCase()}`;
  byKey.set(key, [...(byKey.get(key) ?? []), { name, isin: isin.toUpperCase() }]);
});

const cfg = loadConfig();
const pool = createPool(cfg.db);
const [instruments] = await pool.query('SELECT id, symbol FROM instruments WHERE isin IS NULL OR mic IS NULL ORDER BY symbol');

const counts = { filled: 0, notEuronext: 0, missing: 0, ambiguous: 0, invalid: 0 };
const updates = [];
for (const inst of instruments) {
  const m = /^(.+)\.([A-Z]+)$/.exec(inst.symbol);
  const market = m && MARKETS[m[2]];
  if (!market) { counts.notEuronext++; continue; }
  const hits = byKey.get(`${market[0]}|${m[1]}`) ?? [];
  if (hits.length !== 1) {
    counts[hits.length ? 'ambiguous' : 'missing']++;
    console.log(`${inst.symbol.padEnd(12)} ${hits.length ? `ambíguo (${hits.length} linhas)` : `não consta do ficheiro (${market[0]})`}`);
    continue;
  }
  const parsed = parseIsinMic(`${hits[0].isin}-${market[1]}`);
  if (!parsed) { counts.invalid++; console.log(`${inst.symbol.padEnd(12)} ISIN inválido no ficheiro: ${hits[0].isin}`); continue; }
  counts.filled++;
  updates.push({ id: Number(inst.id), symbol: inst.symbol, ...parsed });
  console.log(`${inst.symbol.padEnd(12)} ${parsed.isin}-${parsed.mic}  ${hits[0].name}`);
}

if (apply && updates.length) {
  await withTransaction(pool, async (conn) => {
    for (const u of updates) {
      await conn.query('UPDATE instruments SET isin = ?, mic = ? WHERE id = ? AND (isin IS NULL OR mic IS NULL)', [u.isin, u.mic, u.id]);
      await audit(conn, null, 'instrument.isin_mic', 'instrument', u.id, { symbol: u.symbol, isinMic: `${u.isin}-${u.mic}`, source: 'ISIN.xlsx' });
    }
  });
}
await pool.end();

console.log(`\n${instruments.length} sem ISIN-MIC: ${counts.filled} ${apply ? 'preenchidos' : 'a preencher (use --apply)'}, `
  + `${counts.missing} não constam do ficheiro, ${counts.ambiguous} ambíguos, ${counts.invalid} com ISIN inválido, `
  + `${counts.notEuronext} fora da Euronext`);
