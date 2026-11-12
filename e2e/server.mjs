/**
 * Servidor dos testes no navegador: a API real com o frontend compilado, sobre a base de dados de TESTES (stocks_test,
 * apagada e recriada aqui), e a SAXO falsa. Nunca toca na base de produção nem na SAXO.
 *   node e2e/server.mjs   (porta STOCKS_E2E_PORT, por omissão 3999)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../api/src/app.js';
import { createPool } from '../api/src/db.js';
import { encryptSecret } from '../api/src/secrets.js';
import { hasTestDb, makeInstrument, makeUser, recentSessions, resetDb, TEST_SECRET_KEY, testConfig } from '../api/test/helpers.js';
import { createFakeSaxo } from './fake-saxo.mjs';

if (!hasTestDb) {
  console.error('falta STOCKS_TEST_DB_PASSWORD (.env na raiz): os testes no navegador usam a base de dados de testes');
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.STOCKS_E2E_PORT ?? 3999);
const cfg = testConfig({ frontendDist: path.join(root, 'frontend', 'dist'), testNoRateLimit: true });
cfg.saxo.streaming = false;
cfg.saxo.watchSeconds = 0;
cfg.saxo.orderSpacingMs = 0;
// Cópias de segurança: pasta temporária com uma cópia de exemplo (nunca a pasta de produção).
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-e2e-backups-'));
fs.writeFileSync(path.join(backupDir, 'stocks-20261101T033000Z.sql.gz'), 'cópia de exemplo');
cfg.backup = { dir: backupDir, script: '/bin/true' };
const pool = createPool(cfg.db);
await resetDb(pool);

// Dados: um administrador com 2.º factor, 300 sessões de dois instrumentos, ligação à SAXO e três leituras da conta.
export const EMAIL = 'e2e@exemplo.pt';
const userId = await makeUser(pool, EMAIL);
await pool.query('UPDATE users SET is_admin = 1 WHERE id = ?', [userId]);
const sessions = recentSessions(300);
const series = (base, amp) => sessions.map((_, i) => (base + amp * Math.sin(i / 9) + i * 0.01).toFixed(2));
const galp = await makeInstrument(pool, 'GALP.LS', { closes: series(15, 1.5), sessions });
const bcp = await makeInstrument(pool, 'BCP.LS', { closes: series(0.8, 0.05), sessions });
await pool.query("UPDATE instruments SET name = 'Galp Energia', exchange = 'Lisbon' WHERE id = ?", [galp]);
await pool.query("UPDATE instruments SET name = 'Banco Comercial Português', exchange = 'Lisbon' WHERE id = ?", [bcp]);
await pool.query('INSERT INTO watchlist_items (user_id, instrument_id) VALUES (?, ?), (?, ?)', [userId, galp, userId, bcp]);
// Site da Galp (para o módulo Logotipos); perfil ainda por recolher, o cartão «Empresa» continua sem dados.
await pool.query("INSERT INTO company_profiles (instrument_id, status, website) VALUES (?, 'missing', 'https://www.galp.com')", [galp]);
await pool.query(
  `INSERT INTO user_integration_tokens (user_id, provider, token_enc, environment, auth_kind, refresh_token_enc, expires_at, refresh_expires_at)
   VALUES (?, 'saxo', ?, 'sim', 'oauth', ?, NOW(3) + INTERVAL 1 DAY, NOW(3) + INTERVAL 2 DAY)`,
  [userId, encryptSecret(TEST_SECRET_KEY, 'token-e2e'), encryptSecret(TEST_SECRET_KEY, 'refresh-e2e')],
);
const tick = JSON.stringify({ DefaultTickSize: 0.001, Elements: [{ HighPrice: 1e9, TickSize: 0.001 }] });
for (const [id, uic, symbol] of [[galp, 23737, 'GALP:xlis'], [bcp, 24000, 'BCP:xlis']]) {
  await pool.query(
    `INSERT INTO saxo_instruments (instrument_id, environment, uic, saxo_symbol, exchange_id, currency, description, tradable, order_types, min_size, tick_scheme, source)
     VALUES (?, 'sim', ?, ?, 'LISB', 'EUR', ?, 1, 'Market,Limit,StopIfTraded,TrailingStopIfTraded', 1, ?, 'auto')`, [id, uic, symbol, symbol, tick],
  );
}
for (const [i, total] of [[3, 1000000], [2, 1004000], [1, 998500]]) {
  await pool.query("INSERT INTO saxo_account_history (user_id, session_date, total_value, cash_balance, positions_value) VALUES (?, ?, ?, ?, ?)",
    [userId, sessions.at(-1 - i), total, total - 1500, 1500]);
}

const lastGalp = Number(series(15, 1.5).at(-1));
const saxo = createFakeSaxo({ cash: 298500, positions: [{ uic: 23737, amount: 100, openPrice: 14, symbol: 'GALP:xlis', openedAt: `${sessions.at(-20)}T09:30:00Z` }], prices: { 23737: lastGalp, 24000: 0.8 } });
cfg.saxo.fetchImpl = saxo.fetchImpl;

const app = await buildApp({ pool, cfg, logger: false });
// Só neste servidor: o que a SAXO falsa recebeu, para os testes confirmarem.
app.get('/__saxo', async () => ({ cash: saxo.state.cash, orders: saxo.state.orders.map((o) => o.body), positions: saxo.state.positions }));
await app.listen({ host: '127.0.0.1', port });
console.log(`e2e: pronto em http://127.0.0.1:${port} (GALP=${galp}, BCP=${bcp})`);
