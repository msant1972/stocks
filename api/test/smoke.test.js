import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, login, makeInstrument, makeUser, setup } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = fs.readFileSync(path.join(here, '..', 'openapi.yaml'), 'utf8');

/** Rotas GET da especificação, sem parâmetros obrigatórios para além do caminho. */
function getRoutes() {
  const lines = spec.split('\n');
  const out = [];
  let current = null;
  for (const l of lines) {
    const p = l.match(/^ {2}(\/api\/v1\/[^ ]*):$/);
    if (p) current = p[1];
    else if (current && /^ {4}get:$/.test(l)) out.push(current);
  }
  return out;
}

describe.skipIf(!hasTestDb)('todas as rotas de leitura', () => {
  let ctx;
  let cookie;
  let id;
  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.saxo.fetchImpl = async () => new Response('{}', { status: 200 });
    const userId = await makeUser(ctx.pool, 'smoke@exemplo.pt');
    await ctx.pool.query('UPDATE users SET is_admin = 1 WHERE id = ?', [userId]);
    cookie = await login(ctx.app, 'smoke@exemplo.pt');
    id = await makeInstrument(ctx.pool, 'GALP.LS', { closes: ['10', '11'] });
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('nenhuma responde com erro interno, e a carteira virtual já não existe', async () => {
    const routes = getRoutes();
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.some((r) => r.includes('/simulated-trades') || r.endsWith('/v1/portfolio'))).toBe(false);
    const failed = [];
    for (const r of routes) {
      if (r.includes('/integrations/saxo/callback')) continue; // retorno da SAXO: redirecciona
      const url = r.replace(/\{[^}]+\}/g, String(id));
      const res = await ctx.app.inject({ method: 'GET', url, headers: { cookie } });
      if (res.statusCode >= 500) failed.push(`${url}: ${res.statusCode} ${res.body.slice(0, 160)}`);
    }
    expect(failed).toEqual([]);
    for (const url of ['/api/v1/portfolio', '/api/v1/portfolio/history', '/api/v1/simulated-trades']) {
      expect((await ctx.app.inject({ method: 'GET', url, headers: { cookie } })).statusCode).toBe(404);
    }
  }, 120_000);
});
