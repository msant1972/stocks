import { execFile } from 'node:child_process';
import { listOrders, openSession } from './service.js';
import { createStreamManager } from './streaming.js';
import { refreshDueTokens } from './tokens.js';
import { maybeWeeklyRecheck } from './catalog-runner.js';
import { runDueAutomation } from './automation.js';
import { takeDueSnapshots } from './history.js';

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

/** Actualiza as ordens de um utilizador (estado final, avisos); devolve quantos avisos novos gerou. */
export async function refreshUserOrders(pool, cfg, userId) {
  const session = await openSession(pool, cfg, userId);
  return (await listOrders(pool, session, { limit: 1 })).ended;
}

/** Confronta com a SAXO as ordens abertas de cada utilizador; as que terminaram geram aviso e email. */
export async function watchOrders(pool, cfg, log = null) {
  const [users] = await pool.query("SELECT DISTINCT user_id FROM saxo_orders WHERE status = 'working'");
  let ended = 0;
  for (const { user_id: userId } of users) {
    try {
      ended += await refreshUserOrders(pool, cfg, userId);
    } catch (err) {
      log?.debug?.({ userId, code: err.code }, 'saxo: ordens não actualizadas');
    }
  }
  if (ended) await sendPendingEmails(cfg, log);
  return ended;
}

/**
 * Vigia periódica (por omissão a cada 60 s): renova os tokens que estão a acabar, confronta as ordens abertas com a SAXO e
 * mantém o streaming (avisos no momento em que uma ordem muda). Devolve a função que a pára.
 */
export function startOrderWatcher(pool, cfg, log = null) {
  const every = cfg.saxo.watchSeconds * 1000;
  if (!(every > 0)) return () => {};
  const stream = createStreamManager({
    pool, cfg, log,
    onOrdersChanged: async (userId) => { if (await refreshUserOrders(pool, cfg, userId)) await sendPendingEmails(cfg, log); },
  });
  const tick = () => refreshDueTokens(pool, cfg, log)
    .then(() => watchOrders(pool, cfg, log))
    .then(() => stream.sync())
    .then(() => maybeWeeklyRecheck(pool, cfg, log))
    .then(() => takeDueSnapshots(pool, cfg, { log }))
    .catch((e) => log?.warn?.({ err: e.message }, 'saxo: vigia falhou'));
  // A automação corre à parte: envia uma ordem por segundo e não pode atrasar a vigia.
  const fullTick = () => {
    runDueAutomation(pool, cfg, { log }).catch((e) => log?.warn?.({ err: e.message }, 'saxo: automação falhou'));
    return tick();
  };
  const timer = setInterval(fullTick, every);
  timer.unref();
  return () => { clearInterval(timer); stream.closeAll(); };
}
