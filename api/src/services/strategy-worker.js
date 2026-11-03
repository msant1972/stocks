/** Worker thread: calcula as estratégias pedidas em todo o catálogo, com uma ligação própria à BD (ver strategyRuns.js). */
import { parentPort, workerData } from 'node:worker_threads';
import { createPool } from '../db.js';
import { getStrategy } from '../../../shared/strategies/index.js';
import { computeStrategies } from './strategyRuns.js';

const pool = createPool({ ...workerData.db, connectionLimit: 2 });
try {
  const out = await computeStrategies(pool, workerData.ids.map(getStrategy), { part: workerData.part, of: workerData.of });
  parentPort.postMessage(Object.fromEntries(out));
} finally {
  await pool.end();
}
