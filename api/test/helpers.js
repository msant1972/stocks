import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { createUser } from '../src/services/users.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export const hasTestDb = Boolean(process.env.STOCKS_TEST_DB_PASSWORD);

// Parâmetros de scrypt baixos, só para os testes correrem depressa.
export const FAST_HASH = { N: 1024, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
export const PASSWORD = 'palavra-passe-de-teste';

export function testConfig(overrides = {}) {
  return {
    ...loadConfig({
      ...process.env,
      STOCKS_DB_HOST: process.env.STOCKS_TEST_DB_HOST ?? '127.0.0.1',
      STOCKS_DB_USER: process.env.STOCKS_TEST_DB_USER ?? 'stocks',
      STOCKS_DB_PASSWORD: process.env.STOCKS_TEST_DB_PASSWORD ?? 'x',
      STOCKS_DB_NAME: process.env.STOCKS_TEST_DB_NAME ?? 'stocks_test',
      STOCKS_PUBLIC_ORIGIN: '',
      STOCKS_LOGIN_MAX_ATTEMPTS: '1000',
    }),
    ...overrides,
  };
}

/** Recria o esquema completo a partir das migrações (secção migrate:up de cada ficheiro). */
export async function resetDb(pool) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const [tables] = await conn.query('SHOW TABLES');
    for (const t of tables) await conn.query(`DROP TABLE \`${Object.values(t)[0]}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    const dir = path.join(root, 'db', 'migrations');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const up = fs.readFileSync(path.join(dir, file), 'utf8').split('-- migrate:up')[1].split('-- migrate:down')[0];
      const sql = up.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await conn.query(stmt);
    }
  } finally {
    conn.release();
  }
}

export async function setup() {
  const cfg = testConfig();
  const pool = createPool(cfg.db);
  await resetDb(pool);
  const app = await buildApp({ pool, cfg, logger: false });
  return { app, pool, cfg };
}

export async function makeUser(pool, email, capital = '10000.00') {
  const id = await createUser(pool, { email, name: email.split('@')[0], password: PASSWORD, initialCapital: capital }, FAST_HASH);
  return id;
}

export async function login(app, email, password = PASSWORD) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login falhou: ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((x) => x.name === 'stocks_session');
  return `stocks_session=${c.value}`;
}

/** Últimos n dias úteis até hoje (UTC), do mais antigo para o mais recente. */
export function recentSessions(n) {
  const out = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

/** Instrumento com cotações: closes é a lista de fechos, atribuídos às últimas sessões. */
export async function makeInstrument(pool, symbol, { currency = 'EUR', status = 'active', closes = ['10.00'], sessions } = {}) {
  const dates = sessions ?? recentSessions(closes.length);
  const [res] = await pool.query(
    "INSERT INTO instruments (symbol, exchange, currency, name, status, first_session, last_session) VALUES (?, 'Teste', ?, ?, ?, ?, ?)",
    [symbol, currency, `Empresa ${symbol}`, status, closes.length ? dates[0] : null, closes.length ? dates.at(-1) : null],
  );
  for (let i = 0; i < closes.length; i++) {
    await pool.query(
      "INSERT INTO daily_quotes (instrument_id, session_date, open, high, low, close, adj_close, volume, source) VALUES (?, ?, ?, ?, ?, ?, ?, 1000, 'teste')",
      [res.insertId, dates[i], closes[i], closes[i], closes[i], closes[i], closes[i]],
    );
  }
  return res.insertId;
}

export const api = (app, cookie) => ({
  get: (url) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } }),
  post: (url, payload) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie }, payload }),
  patch: (url, payload) => app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers: { cookie }, payload }),
  put: (url, payload) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie }, payload }),
  del: (url) => app.inject({ method: 'DELETE', url: `/api/v1${url}`, headers: { cookie } }),
});
