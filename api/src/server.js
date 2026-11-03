import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { startOrderWatcher } from './saxo/watcher.js';

const cfg = loadConfig();
const pool = createPool(cfg.db);
const app = await buildApp({ pool, cfg, warm: true });
let stopWatcher = () => {};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    app.log.info(`${signal} recebido; a terminar`);
    stopWatcher();
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ host: cfg.host, port: cfg.port });
stopWatcher = startOrderWatcher(pool, cfg, app.log); // avisos das ordens SAXO que deixam de estar abertas
