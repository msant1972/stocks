import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.STOCKS_E2E_PORT ?? 3999);

/** Um só servidor, com estado partilhado (base de testes e SAXO falsa): os testes correm em série. */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, locale: 'pt-PT', timezoneId: 'Europe/Lisbon', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'npm --prefix ../frontend run build --silent && node server.mjs',
    url: `http://127.0.0.1:${port}/health/live`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
  },
});
