/**
 * Carrega a lista oficial da Euronext (ISIN.xlsx na raiz do repositório: colunas Name, ISIN, Symbol, Market) para
 * a tabela euronext_isins, substituindo o conteúdo anterior, e preenche o ISIN-MIC dos instrumentos do catálogo
 * que ainda não o têm. Daí em diante, o motor de recolha preenche-o sozinho em cada instrumento novo que valida.
 *
 * Correspondência: o símbolo Yahoo do instrumento tem de ser o símbolo Euronext com o sufixo do mercado
 * (GALP.LS → GALP em Euronext Lisbon, MIC XLIS). Os instrumentos fora da Euronext (.DE, .MC, .HE, …) não têm
 * livro de ofertas e ficam sem ISIN-MIC. Sem --apply só mostra o que faria.
 *
 *   cd api && node --env-file=../.env ../scripts/isin-mic-from-xlsx.mjs [--apply] [ficheiro.xlsx]
 */
import { fileURLToPath } from 'node:url';
import { createPool } from '../api/src/db.js';
import { loadConfig } from '../api/src/config.js';
import { fillMissingIsinMics, MARKETS, readIsinFile, replaceEuronextIsins } from '../api/src/services/euronextIsins.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--')) ?? fileURLToPath(new URL('../ISIN.xlsx', import.meta.url));

const { rows, rejected } = await readIsinFile(file);
for (const r of rejected) console.log(`linha ${r.line} (${r.symbol}): ignorada, ${r.reason}`);

const pool = createPool(loadConfig().db);
if (apply) await replaceEuronextIsins(pool, rows);
console.log(`${rows.length} instrumentos Euronext ${apply ? 'carregados em euronext_isins' : 'a carregar em euronext_isins'}`
  + (rejected.length ? `, ${rejected.length} linhas ignoradas` : ''));

// Sem --apply a tabela não foi actualizada: a pré-visualização usa as linhas do ficheiro directamente.
let filled;
if (apply) {
  filled = await fillMissingIsinMics(pool);
} else {
  const byYahoo = new Map(rows.map((r) => [r.yahooSymbol, r]));
  const [missing] = await pool.query('SELECT id, symbol FROM instruments WHERE isin IS NULL OR mic IS NULL ORDER BY symbol');
  filled = missing.filter((i) => byYahoo.has(i.symbol)).map((i) => {
    const r = byYahoo.get(i.symbol);
    return { id: Number(i.id), symbol: i.symbol, isinMic: `${r.isin}-${r.mic}`, name: r.name };
  });
}
for (const f of filled) console.log(`${f.symbol.padEnd(12)} ${f.isinMic}  ${f.name ?? ''}`);

// Instrumentos de mercados Euronext que continuam sem ISIN-MIC (não constam do ficheiro).
const suffixes = Object.values(MARKETS).map((m) => m.suffix);
const filledIds = new Set(filled.map((f) => f.id));
const [still] = await pool.query('SELECT id, symbol FROM instruments WHERE isin IS NULL OR mic IS NULL ORDER BY symbol');
const absent = still.filter((i) => !filledIds.has(Number(i.id)) && suffixes.some((s) => i.symbol.endsWith(s)));
for (const a of absent) console.log(`${a.symbol.padEnd(12)} não consta do ficheiro`);
await pool.end();

console.log(`\n${filled.length} instrumentos ${apply ? 'preenchidos' : 'a preencher (use --apply)'}, `
  + `${absent.length} da Euronext sem correspondência no ficheiro`);
