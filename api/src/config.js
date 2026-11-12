import { loadSecretKey } from './secrets.js';

/** Configuração lida de variáveis de ambiente; os segredos nunca ficam no código. */
export function loadConfig(env = process.env) {
  const required = (key) => {
    if (!env[key]) throw new Error(`variável de ambiente ${key} em falta`);
    return env[key];
  };
  const publicOrigin = env.STOCKS_PUBLIC_ORIGIN || null; // ex.: https://stocks.graus.pt
  return {
    db: {
      host: env.STOCKS_DB_HOST || '127.0.0.1',
      port: Number(env.STOCKS_DB_PORT || 3306),
      user: env.STOCKS_DB_USER || 'stocks',
      password: required('STOCKS_DB_PASSWORD'),
      database: env.STOCKS_DB_NAME || 'stocks',
    },
    host: env.STOCKS_API_HOST || '127.0.0.1',
    port: Number(env.STOCKS_API_PORT || 3000),
    logLevel: env.STOCKS_LOG_LEVEL || 'info',
    publicOrigin,
    // Por omissão, cookies Secure sempre que a origem pública é HTTPS.
    secureCookies: env.STOCKS_SECURE_COOKIES
      ? env.STOCKS_SECURE_COOKIES === 'true'
      : Boolean(publicOrigin?.startsWith('https://')),
    sessionDays: Number(env.STOCKS_SESSION_DAYS || 7),
    // Tentativas de login por IP em 15 minutos.
    loginMaxAttempts: Number(env.STOCKS_LOGIN_MAX_ATTEMPTS || 10),
    // Dias de calendário a partir dos quais a última cotação é considerada desactualizada
    // e as operações simuladas são recusadas (cobre fins-de-semana e feriados prolongados).
    maxQuoteAgeDays: Number(env.STOCKS_MAX_QUOTE_AGE_DAYS || 7),
    frontendDist: env.STOCKS_FRONTEND_DIST || null,
    // Ficheiro observado por uma unit .path do systemd: tocar-lhe arranca o motor de recolha de imediato.
    // Sem ele, os pedidos ficam para a próxima execução do timer (a cada 5 minutos).
    fetchTriggerFile: env.STOCKS_FETCH_TRIGGER_FILE || null,
    // Chave para cifrar segredos na BD (palavra-passe SMTP); em produção vem de /etc/stocks/secret.key.
    secretKey: loadSecretKey({ STOCKS_SECRET_KEY_FILE: '/etc/stocks/secret.key', ...env }),
    // Cópias de segurança da base de dados (Definições → Cópias de segurança): pasta onde o deploy/bin/backup.sh as guarda
    // e o script que as cria. backupScript: só os testes o mudam.
    backup: {
      dir: env.STOCKS_BACKUP_DIR || '/var/backups/stocks',
      script: env.STOCKS_BACKUP_SCRIPT || '/opt/stocks/deploy/bin/backup.sh',
    },
    // Python do motor de alertas, usado para enviar o email de teste com o mesmo código dos alertas.
    alertsPython: env.STOCKS_ALERTS_PYTHON || null,
    // Ligação à SAXO Bank. Só a conta de simulação (SIM); a conta real fica recusada até STOCKS_SAXO_ALLOW_LIVE=true.
    saxo: {
      allowLive: env.STOCKS_SAXO_ALLOW_LIVE === 'true',
      authUrl: env.STOCKS_SAXO_SIM_AUTH_URL || 'https://sim.logonvalidation.net', // servidor de autorização (SIM)
      simUrl: env.STOCKS_SAXO_SIM_URL || 'https://gateway.saxobank.com/sim/openapi',
      liveUrl: env.STOCKS_SAXO_LIVE_URL || 'https://gateway.saxobank.com/openapi',
      timeoutMs: Number(env.STOCKS_SAXO_TIMEOUT_MS || 10_000),
      orderSpacingMs: 1100, // a SAXO só aceita 1 pedido/s a /trade/v2/orders (pré-validação e envio partilham o limite)
      streamUrl: env.STOCKS_SAXO_SIM_STREAM_URL || 'wss://sim-streaming.saxobank.com/sim/oapi/streaming/ws/connect',
      streaming: env.STOCKS_SAXO_STREAMING !== 'false', // avisos instantâneos das ordens (WebSocket); a vigia de 60 s fica de reserva
      watchSeconds: Number(env.STOCKS_SAXO_WATCH_SECONDS ?? 60), // vigia das ordens abertas; 0 desliga
      // Ligação do catálogo inteiro: pausa entre instrumentos (até 4 pedidos cada; fica abaixo dos limites da SAXO)
      // e revalidação automática semanal (false desliga).
      // Capital com que a conta de simulação da SAXO começou: a SAXO não o indica e é a base do resultado acumulado.
      initialCapital: Number(env.STOCKS_SAXO_INITIAL_CAPITAL ?? 1_000_000),
      // Precheck da SAXO em todas as ordens (por omissão só a mercado, com stop ou na conta real).
      alwaysPrecheck: env.STOCKS_SAXO_ALWAYS_PRECHECK === 'true',
      catalogPauseMs: Number(env.STOCKS_SAXO_CATALOG_PAUSE_MS ?? 1200),
      catalogWeekly: env.STOCKS_SAXO_CATALOG_WEEKLY !== 'false',
      fetchImpl: null, // só para testes
    },
  };
}
