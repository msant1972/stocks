import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rollingMean } from '../../shared/momentum.js';
import { momentum } from '../../shared/momentum.js';
import { backtest } from '../../shared/strategies/a-momentum.js';
import { strategyCosts } from '../../shared/costs.js';
import { api, hasTestDb, login, makeInstrument, makeUser, recentSessions, setup } from './helpers.js';

const yearsAgo = (date, n) => { const [y, m, d] = date.split('-').map(Number); const t = new Date(Date.UTC(y - n, m - 1, d)); if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); return t.toISOString().slice(0, 10); };

/** Instrumento com `n` sessões de fechos ondulantes e médias calculadas como o motor de recolha. */
async function wavy(pool, symbol, n) {
  const dates = recentSessions(n);
  const closes = dates.map((_, k) => (50 + 15 * Math.sin(k / 23) + 6 * Math.sin(k / 7) + k * 0.01).toFixed(2));
  const id = await makeInstrument(pool, symbol, { closes, sessions: dates });
  const nums = closes.map(Number);
  const [s10, s125, s200] = [10, 125, 200].map((p) => rollingMean(nums, p));
  for (let k = 0; k < dates.length; k++) {
    await pool.query('UPDATE daily_quotes SET sma10 = ?, sma125 = ?, sma200 = ? WHERE instrument_id = ? AND session_date = ?',
      [s10[k]?.toFixed(6) ?? null, s125[k]?.toFixed(6) ?? null, s200[k]?.toFixed(6) ?? null, id, dates[k]]);
  }
  await pool.query('UPDATE daily_quotes SET high = close * 1.01, low = close * 0.99, volume = 1000000 WHERE instrument_id = ?', [id]);
  return { id, last: dates.at(-1) };
}

describe.skipIf(!hasTestDb)('BackTest: período de verificação e custos', () => {
  let ctx;
  let ana;
  let longo;
  beforeAll(async () => {
    ctx = await setup();
    await makeUser(ctx.pool, 'ana@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'ana@exemplo.pt'));
    longo = await wavy(ctx.pool, 'LONGO.LS', 1310); // ~5 anos
    await wavy(ctx.pool, 'CURTO3.LS', 780);         // ~3 anos: só metade do período de verificação
  }, 240_000);
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('verificação: os 2 anos antes dos últimos 2, só com cotações até ao início destes', async () => {
    const res = await ana.get('/backtest?period=verification');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ period: 'verification', costs: false });
    const row = res.json().items.find((i) => i.instrumentId === longo.id);
    const end = yearsAgo(longo.last, 2);
    expect(row.windowFrom).toBe(yearsAgo(end, 2));
    expect(row.toDate <= end).toBe(true);
    // O mesmo que a estratégia corrida à mão sobre essa janela.
    const { quotes } = (await ana.get(`/instruments/${longo.id}/quotes?from=${yearsAgo(end, 2)}&to=${end}`)).json();
    const expected = backtest(quotes, momentum(quotes)).summary;
    expect(row).toMatchObject({ sessions: quotes.length, closed: expected.closed, total: expected.total });
    const recent = (await ana.get('/backtest')).json().items.find((i) => i.instrumentId === longo.id);
    expect(recent.windowFrom).toBe(yearsAgo(longo.last, 2));
    expect(recent.toDate).toBe(longo.last);
  });

  it('com custos: o resultado, os anos e comprar e manter descontam os custos estimados das ordens', async () => {
    const gross = (await ana.get('/backtest')).json().items.find((i) => i.instrumentId === longo.id);
    const res = await ana.get('/backtest?costs=true');
    const body = res.json();
    expect(body.costs).toBe(true);
    expect(body.costModel).toMatchObject({ commissionPct: 0.08, commissionMin: 3 });
    expect(body.costModel.text).toMatch(/comissão/);
    const net = body.items.find((i) => i.instrumentId === longo.id);
    expect(gross.costs).toBeGreaterThan(0);
    expect(net.total).toBeCloseTo(gross.total - gross.costs, 2);
    expect(net.firstYear).toBeCloseTo(gross.firstYear - gross.costsFirstYear, 2);
    expect(net.secondYear).toBeCloseTo(gross.secondYear - gross.costsSecondYear, 2);
    expect(net.buyHoldPnl).toBeCloseTo(gross.buyHoldPnl - gross.buyHoldCosts, 2);
    expect(net.wins).toBe(gross.winsNet);
    expect(gross.orders).toBeGreaterThan(gross.closed);
    // Os custos coincidem com shared/costs.js aplicado à simulação da página do instrumento.
    const { quotes } = (await ana.get(`/instruments/${longo.id}/quotes`)).json();
    const r = backtest(quotes, momentum(quotes));
    expect(gross.costs).toBe(strategyCosts(r, { mid: yearsAgo(longo.last, 1), lastDate: longo.last }).total);
  });

  it('comparação: período, custos, janela e instrumentos com histórico em toda ela', async () => {
    const res = await ana.get('/strategies/compare?period=verification&costs=true');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ period: 'verification', costs: true, instruments: 2, fullHistory: 1, persistence: null });
    expect(body.fromDate).toBe(yearsAgo(yearsAgo(longo.last, 2), 2));
    const gross = (await ana.get('/strategies/compare?period=verification')).json();
    const a = (b) => b.items.find((s) => s.id === 'a-momentum');
    expect(a(body).total).toBeLessThan(a(gross).total);
    expect((await ana.get('/strategies/compare?period=passado')).statusCode).toBe(400);
  });
});
