// Capturas de ecrã de todas as páginas (servidor de testes já a correr). node shots.mjs <pasta> [largura] [altura]
import { chromium } from '@playwright/test';
import { totp } from '../api/src/auth/totp.js';
const [out, w = '1920', h = '1080'] = process.argv.slice(2);
const base = `http://127.0.0.1:${process.env.STOCKS_E2E_PORT ?? 3999}`;
const pages = ['/', '/acompanhar', '/charts', '/orderbook', '/heatmap', '/timelapse', '/alertas', '/saxo/carteira', '/saxo/ordens',
  '/saxo/alertas', '/saxo/automacao', '/sinais', '/backtest', '/comparar', '/winners-loosers', '/promessas', '/pechinchas', '/calor',
  '/laboratorio', '/utilizadores', '/saxo/correspondencia', '/definicoes'];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, locale: 'pt-PT', timezoneId: 'Europe/Lisbon' });
await page.goto(base + '/');
await page.getByLabel('Email').fill('e2e@exemplo.pt');
await page.getByLabel('Palavra-passe', { exact: true }).fill('palavra-passe-de-teste');
await page.getByRole('button', { name: 'Entrar' }).click();
await page.getByLabel('Código de 6 dígitos').fill(totp('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'));
await page.getByRole('button', { name: /Confirmar|Entrar|Verificar/ }).click();
await page.waitForSelector('h1');
const only = process.env.ONLY?.split(',');
for (const p of pages) {
  if (only && !only.includes(p)) continue;
  await page.goto(base + p);
  await page.waitForSelector('h1');
  await page.waitForTimeout(1500);
  const name = (p === '/' ? 'visao' : p.slice(1).replace(/\//g, '_')) + `-${w}.png`;
  await page.screenshot({ path: `${out}/${name}`, fullPage: process.env.FULL === '1' });
}
await browser.close();
