// Gera api/openapi.yaml a partir dos esquemas das rotas (contrato de referência para o frontend).
import fs from 'node:fs';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';

const cfg = loadConfig({ ...process.env, STOCKS_DB_PASSWORD: process.env.STOCKS_DB_PASSWORD || 'nao-usada' });
const pool = createPool(cfg.db); // não chega a ligar: nenhuma rota é executada
const app = await buildApp({ pool, cfg, logger: false });
await app.ready();
fs.writeFileSync(new URL('../openapi.yaml', import.meta.url), app.swagger({ yaml: true }));
await app.close();
await pool.end();
console.log('openapi.yaml actualizado');
