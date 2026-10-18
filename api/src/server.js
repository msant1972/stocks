import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';

const cfg = loadConfig();
const pool = createPool(cfg.db);
const app = await buildApp({ pool, cfg });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    app.log.info(`${signal} recebido; a terminar`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ host: cfg.host, port: cfg.port });
