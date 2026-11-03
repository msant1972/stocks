/**
 * Cálculo antecipado das páginas pesadas (BackTest, Comparar, WinnersLoosers, Promessas, Sinais, melhor estratégia),
 * para abrirem de imediato: corre no arranque da API e sempre que a recolha de cotações termina, e as caches
 * (stale-while-revalidate, nas rotas) mantêm-se actuais em segundo plano. Só activo no servidor (buildApp com warm).
 */
const CHECK_MS = 2 * 60_000;

/** tasks: funções assíncronas que recalculam uma cache (ver as rotas); correm uma de cada vez. */
export function scheduleWarmups(app, pool, tasks) {
  let timer = null;
  let stopped = false;
  let busy = false;
  let marker = null;

  const runAll = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const task of tasks) {
        if (stopped) return;
        try { await task(); } catch (err) { app.log.warn({ err }, 'cálculo antecipado falhou'); }
      }
    } finally {
      busy = false;
    }
  };
  // Última recolha (diária ou horária) concluída: quando muda, há cotações novas.
  const lastRun = async () => {
    const [[r]] = await pool.query("SELECT MAX(id) AS id FROM job_runs WHERE status = 'done' AND kind IN ('fetch_update', 'fetch_intraday')");
    return r.id == null ? null : Number(r.id);
  };

  app.addHook('onReady', async () => {
    marker = await lastRun().catch(() => null);
    setImmediate(runAll); // sem atrasar o arranque
    timer = setInterval(async () => {
      try {
        const m = await lastRun();
        if (m !== marker) { marker = m; await runAll(); }
      } catch (err) {
        app.log.warn({ err }, 'verificação da recolha falhou');
      }
    }, CHECK_MS);
    timer.unref();
  });
  app.addHook('onClose', async () => { stopped = true; clearInterval(timer); });
}
