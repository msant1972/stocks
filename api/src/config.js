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
    initialCapital: env.STOCKS_INITIAL_CAPITAL || '10000.00',
    // Dias de calendário a partir dos quais a última cotação é considerada desactualizada
    // e as operações simuladas são recusadas (cobre fins-de-semana e feriados prolongados).
    maxQuoteAgeDays: Number(env.STOCKS_MAX_QUOTE_AGE_DAYS || 7),
    frontendDist: env.STOCKS_FRONTEND_DIST || null,
  };
}
