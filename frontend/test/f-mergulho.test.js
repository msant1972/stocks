import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { backtest, DEFAULT_OPTIONS, resolveOptions } from '../../shared/strategies/f-mergulho.js';
import { getStrategy } from '../../shared/strategies/index.js';

const asml = JSON.parse(fs.readFileSync(new URL('./fixtures/asml-as.json', import.meta.url), 'utf8'));

/** Série diária (dias úteis) a partir de fechos; o fecho ajustado é igual ao fecho e a abertura é o fecho anterior. */
const series = (closes, start = '2024-01-01') => {
  const d = new Date(`${start}T00:00:00Z`);
  return closes.map((c, i) => {
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    const date = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    const o = i ? closes[i - 1] : c;
    return { date, open: o, high: Math.max(o, c) * 1.002, low: Math.min(o, c) * 0.998, close: c, adjClose: c, volume: 1000 };
  });
};
const ramp = (from, to, n) => Array.from({ length: n }, (_, k) => from + ((to - from) * (k + 1)) / n);
const trend = (n, daily, from = 100) => Array.from({ length: n }, (_, i) => from * (1 + daily) ** i);

test('ASML.AS, últimos 2 anos: as mesmas operações da simulação do Laboratório (experiência 31)', () => {
  const r = backtest(asml, { from: '2024-11-13' });
  assert.deepEqual(r.trades.map((t) => [t.buyDate, t.sellDate, t.leg, t.lots.length, t.reason]), [
    ['2024-11-14', '2025-01-07', 'dip', 1, 'rsi'],
    ['2025-01-28', '2025-05-14', 'dip', 3, 'rsi'],
    ['2025-06-25', '2025-07-17', 'core', 1, 'trend'],
    ['2025-07-17', '2025-09-16', 'dip', 2, 'rsi'],
    ['2025-11-24', '2026-01-06', 'dip', 1, 'rsi'],
    ['2026-03-23', '2026-05-15', 'dip', 1, 'target'],
    ['2026-07-28', '2026-10-05', 'dip', 1, 'rsi'],
    ['2025-09-10', '2026-11-05', 'core', 1, 'trend'],
  ]);
  assert.deepEqual(r.trades.map((t) => Math.round(t.pnlPct * 10) / 10), [14.4, 12.0, -8.3, 20.2, 23.8, 20.8, 19.7, 89.5]);
  assert.equal(r.summary.closed, 8);
  assert.equal(r.summary.wins, 7);
  assert.equal(Math.round(r.summary.total), 32444); // sem custos; com custos estimados, cerca de 31 900 €
  assert.equal(Math.round(r.summary.peakCost), 44145);
  assert.deepEqual(r.open.legs, { core: false, dip: 2 }); // dois lotes de mergulho abertos (16 out. e 4 nov. 2026)
  assert.equal(r.open.reinforcements, 1);
  assert.equal(Math.round(r.open.pnl), -1732);
});

test('formato comum do registo: lotes, 15 000 € à abertura, comprar e manter, motivos', () => {
  const r = backtest(asml, { from: '2024-11-13' });
  for (const t of r.trades) {
    assert.equal(t.quantity, t.lots.reduce((s, l) => s + l.quantity, 0));
    assert.equal(t.reinforcements, t.lots.length - 1);
    assert.ok(['rsi', 'target', 'disaster', 'trend'].includes(t.reason));
  }
  assert.ok(r.trades[0].lots[0].quantity === Math.floor(15000 / r.trades[0].lots[0].price));
  assert.ok(r.summary.buyHold.cost > 14000 && r.summary.buyHold.cost <= 15000);
  const st = getStrategy('f-mergulho');
  assert.equal(st.execution, 'open');
  assert.equal(st.warmupYears, 1);
  assert.match(st.rules, /RSI14 fecha abaixo de 40/);
  assert.match(st.rules, /SMA200/);
  assert.deepEqual(Object.keys(st.reasonLabels).sort(), ['disaster', 'rsi', 'target', 'trend']);
});

test('sem lookahead: cortar a série numa data dá os mesmos sinais até essa data', () => {
  const sides = (r) => r.signals.map((s) => `${s.date} ${s.side} ${s.leg}`);
  const full = backtest(asml, { from: '2024-11-13' });
  const cut = '2026-03-02';
  const part = backtest(asml.filter((q) => q.date <= cut), { from: '2024-11-13' });
  assert.deepEqual(sides(part), sides(full).filter((s) => s.slice(0, 10) <= cut));
});

test('mergulho: compra com RSI14 abaixo de 40 e vende quando passa de 70, na abertura seguinte', () => {
  // Tendência de subida, queda de 15 % (RSI baixo) e recuperação completa.
  const up = trend(260, 0.002);
  const top = up.at(-1);
  const closes = [...up, ...ramp(top, top * 0.85, 15), ...ramp(top * 0.85, top * 1.15, 40)];
  const r = backtest(series(closes), { core: 0 });
  const buys = r.signals.filter((s) => s.side === 'buy');
  const sells = r.signals.filter((s) => s.side === 'sell');
  assert.equal(buys.length, 1);
  assert.ok(buys[0].leg === 'dip' && sells.length === 1 && sells[0].reason === 'rsi');
  assert.ok(r.trades[0].pnl > 0);
  assert.equal(r.open, null);
});

test('lotes seguintes: espaçados e só com o fecho 5 % abaixo do último; no máximo maxLots', () => {
  const up = trend(260, 0.002);
  const top = up.at(-1);
  // Queda contínua de 40 %: compra o 1.º lote e vai acrescentando.
  const closes = [...up, ...ramp(top, top * 0.6, 80)];
  const r = backtest(series(closes), { core: 0, disaster: 0 });
  const adds = r.signals.filter((s) => s.leg === 'dip');
  assert.ok(adds.length >= 2 && adds.length <= DEFAULT_OPTIONS.maxLots);
  for (let k = 1; k < adds.length; k++) {
    assert.ok(adds[k].price <= adds[k - 1].price * (1 - DEFAULT_OPTIONS.step) + 1e-9);
  }
  assert.equal(backtest(series(closes), { core: 0, disaster: 0, maxLots: 1 }).signals.filter((s) => s.leg === 'dip').length, 1);
});

test('protecção: vende os mergulhos 25 % abaixo do lote mais barato', () => {
  const up = trend(260, 0.002);
  const top = up.at(-1);
  const closes = [...up, ...ramp(top, top * 0.5, 100)];
  const r = backtest(series(closes), { core: 0 });
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].reason, 'disaster');
  assert.ok(r.trades[0].pnl < 0);
  // Sem protecção, a posição fica aberta.
  assert.ok(backtest(series(closes), { core: 0, disaster: 0 }).open);
});

test('núcleo: compra 3 % acima da SMA200 e vende 3 % abaixo; core: 0 desliga-o', () => {
  const up = trend(300, 0.002);
  const top = up.at(-1);
  const closes = [...up, ...ramp(top, top * 0.5, 120)];
  const r = backtest(series(closes));
  const core = r.trades.filter((t) => t.leg === 'core');
  assert.equal(core.length, 1);
  assert.equal(core[0].reason, 'trend');
  assert.ok(r.signals.some((s) => s.leg === 'core' && s.side === 'buy'));
  assert.equal(backtest(series(closes), { core: 0 }).signals.some((s) => s.leg === 'core'), false);
});

test('opções: valida chaves e valores; parâmetros por omissão são os do desenho', () => {
  assert.deepEqual(
    [DEFAULT_OPTIONS.budget, DEFAULT_OPTIONS.coreBand, DEFAULT_OPTIONS.rsiIn, DEFAULT_OPTIONS.rsiOut, DEFAULT_OPTIONS.maxLots, DEFAULT_OPTIONS.spacing, DEFAULT_OPTIONS.step, DEFAULT_OPTIONS.target, DEFAULT_OPTIONS.disaster],
    [15000, 0.03, 40, 70, 3, 10, 0.05, 0.2, 0.25],
  );
  assert.throws(() => resolveOptions({ stop: 0.1 }), /desconhecida/);
  assert.throws(() => resolveOptions({ rsiIn: -1 }), /não negativo/);
  assert.throws(() => resolveOptions({ from: '11-11-2024' }), /AAAA-MM-DD/);
  assert.deepEqual(backtest([], {}).trades, []);
});
