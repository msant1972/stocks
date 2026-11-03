import { execFile } from 'node:child_process';
import { listOrders, openSession } from './service.js';

let sending = false;

/** Envia por email os avisos pendentes (motor de alertas: python -m alerts saxo). Sem concorrência; falhas só ficam no log. */
export function sendPendingEmails(cfg, log = null) {
  if (!cfg.alertsPython || sending) return Promise.resolve(false);
  sending = true;
  return new Promise((resolve) => {
    execFile(cfg.alertsPython, ['-m', 'alerts', 'saxo'], { timeout: 60_000, env: process.env }, (err, stdout) => {
      sending = false;
      if (err) log?.warn?.({ err: err.message }, 'saxo: falha ao enviar avisos por email');
      else log?.debug?.({ out: String(stdout).trim() }, 'saxo: avisos por email');
      resolve(!err);
    });
  });
}

/** Confronta com a SAXO as ordens abertas de cada utilizador; as que desapareceram geram aviso e email. */
export async function watchOrders(pool, cfg, log = null) {
  const [users] = await pool.query("SELECT DISTINCT user_id FROM saxo_orders WHERE status = 'working'");
  let ended = 0;
  for (const { user_id: userId } of users) {
    try {
      const session = await openSession(pool, cfg, userId);
      ended += (await listOrders(pool, session, { limit: 1 })).ended;
    } catch (err) {
      log?.debug?.({ userId, code: err.code }, 'saxo: ordens não actualizadas');
    }
  }
  if (ended) await sendPendingEmails(cfg, log);
  return ended;
}

/** Vigia periódica (por omissão a cada 60 s; só chama a SAXO se houver ordens abertas). Devolve a função que a pára. */
export function startOrderWatcher(pool, cfg, log = null) {
  const every = cfg.saxo.watchSeconds * 1000;
  if (!(every > 0)) return () => {};
  const timer = setInterval(() => { watchOrders(pool, cfg, log).catch((e) => log?.warn?.({ err: e.message }, 'saxo: vigia falhou')); }, every);
  timer.unref();
  return () => clearInterval(timer);
}
