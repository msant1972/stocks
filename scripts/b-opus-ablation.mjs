/**
 * Ablação e sensibilidade da B-Opus (docs/arquitectura/B-Opus.md, secção 11.2).
 *
 * Corre a B-Opus em todos os instrumentos activos, na mesma janela do BackTest (3 anos de histórico, actua nos
 * últimos 2), com a configuração por omissão e com cada variante, e escreve tabelas em Markdown.
 * Só lê a base de dados.
 *
 *   cd api && node --env-file=../.env ../scripts/b-opus-ablation.mjs > ../docs/arquitectura/b-opus-ablacao.md
 */
import { createPool } from '../api/src/db.js';
import { loadConfig } from '../api/src/config.js';
import { yearsBefore } from '../api/src/routes/instruments.js';
import { backtest, DEFAULT_OPTIONS } from '../shared/strategies/b-opus.js';

const cfg = loadConfig();
const pool = createPool(cfg.db);
const [rows] = await pool.query(
  `SELECT q.instrument_id AS id, i.symbol, i.last_session, q.session_date AS date, q.open, q.high, q.low, q.close,
          q.adj_close AS adjClose, q.volume
     FROM daily_quotes q JOIN instruments i ON i.id = q.instrument_id
    WHERE i.status = 'active' AND q.session_date >= i.last_session - INTERVAL 3 YEAR - INTERVAL 1 DAY
    ORDER BY q.instrument_id, q.session_date`,
);
await pool.end();

const instruments = new Map();
for (const r of rows) {
  if (!instruments.has(r.id)) instruments.set(r.id, { symbol: r.symbol, histFrom: yearsBefore(r.last_session, 3), from: yearsBefore(r.last_session, 2), quotes: [] });
  const x = instruments.get(r.id);
  if (r.date >= x.histFrom) x.quotes.push(r);
}
const list = [...instruments.values()];

function run(options) {
  const totals = [];
  let trades = 0; let wins = 0;
  for (const x of list) {
    const r = backtest(x.quotes, { from: x.from, ...options });
    totals.push(r.summary.total);
    trades += r.summary.closed; wins += r.summary.wins;
  }
  const sorted = [...totals].sort((a, b) => a - b);
  return {
    sum: totals.reduce((s, v) => s + v, 0),
    gain: totals.filter((v) => v > 0).length,
    loss: totals.filter((v) => v < 0).length,
    worst10: sorted.slice(0, 10).reduce((s, v) => s + v, 0),
    best10: sorted.slice(-10).reduce((s, v) => s + v, 0),
    trades,
    winRate: trades ? (wins / trades) * 100 : 0,
  };
}

const eur = (v) => `${Math.round(v).toLocaleString('pt-PT')} €`;
const row = (label, m, extra = '') => `| ${label} | ${eur(m.sum)} | ${m.gain} / ${m.loss} | ${eur(m.worst10)} | ${eur(m.best10)} | ${m.trades} | ${m.winRate.toFixed(0)}% |${extra}`;
const header = '| Configuração | Soma dos resultados | Com ganho / perda | 10 piores | 10 melhores | Operações | Acerto |';
const sep = '|---|---|---|---|---|---|---|';

const full = run({});
const lines = [
  '# B-Opus — ablação e sensibilidade',
  '',
  `Gerado por \`scripts/b-opus-ablation.mjs\` em ${new Date().toISOString().slice(0, 10)}, sobre ${list.length} instrumentos activos `
    + '(3 anos de histórico, a estratégia actua nos últimos 2; 15 000 € por compra, sem comissões). '
    + 'Resultados indicativos: dois anos de dados não permitem validação fora da amostra.',
  '',
  '## Ablação',
  '',
  header.replace('|', '| Tipo |'),
  '|---|---|---|---|---|---|---|---|',
];
const variants = [
  ['—', 'full (por omissão)', {}],
  ['remover', 'no_trend_strength', { trendStrength: 'none' }],
  ['substituir', 'adx_instead_of_er', { trendStrength: 'adx' }],
  ['remover', 'no_time_stop', { useTimeStop: false }],
  ['adicionar', 'with_volume_confirmation', { volumeConfirmation: true }],
  ['adicionar', 'with_pullback_entry', { pullbackEntry: true }],
  ['adicionar', 'with_overextension_block', { overextensionBlock: true }],
  ['adicionar', 'with_partial_take_profit', { partialTakeProfit: true }],
  ['substituir', 'monthly_review', { review: 'monthly' }],
];
for (const [type, id, options] of variants) {
  const m = id.startsWith('full') ? full : run(options);
  lines.push(`| ${type} |${row(id, m).slice(1)}`);
}

lines.push('', '## Sensibilidade (um parâmetro de cada vez)', '', header, sep);
const ranges = {
  smaTrendFast: [40, 60], smaTrendSlow: [150, 250], m1Fast: [5, 20], m1Slow: [100, 150], m2Lookback: [126, 189],
  m2Skip: [0, 10], atrN: [14, 30], stopMult: [2.5, 3.5, 4.0], erThreshold: [0.20, 0.30], timeStopSessions: [10, 40],
  cooldownSessions: [5, 20], gapProtectAtr: [0.5, 2.0],
};
lines.push(row('por omissão', full));
for (const [key, values] of Object.entries(ranges)) {
  for (const v of values) lines.push(row(`${key} = ${v} (omissão ${DEFAULT_OPTIONS[key]})`, run({ [key]: v })));
}
console.log(lines.join('\n'));
