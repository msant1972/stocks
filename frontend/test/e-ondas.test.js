import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { backtest, DEFAULT_OPTIONS, resolveOptions } from '../../shared/strategies/e-ondas.js';
import { getStrategy } from '../../shared/strategies/index.js';

const a2a = JSON.parse(fs.readFileSync(new URL('./fixtures/a2a-mi.json', import.meta.url), 'utf8'));

/** Série diária (dias úteis) a partir de fechos; o fecho ajustado é igual ao fecho. */
const series = (closes, start = '2024-01-01') => {
  const d = new Date(`${start}T00:00:00Z`);
  return closes.map((c) => {
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    const date = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    return { date, open: c, high: c * 1.005, low: c * 0.995, close: c, adjClose: c, volume: 1000 };
  });
};
const trend = (n, daily, from = 100) => Array.from({ length: n }, (_, i) => from * (1 + daily) ** i);
const ramp = (from, to, n) => Array.from({ length: n }, (_, k) => from + ((to - from) * (k + 1)) / n);
const sides = (r) => r.signals.map((s) => `${s.date} ${s.side}`);

test('A2A.MI (os pontos do utilizador): as mesmas 6 compras e 5 vendas do protótipo, +3 212 €', () => {
  const r = backtest(a2a, { from: '2024-11-11' });
  assert.deepEqual(sides(r), [
    '2025-04-14 buy', '2025-06-20 sell', '2025-09-30 buy', '2025-11-12 sell', '2026-01-07 buy',
    '2026-02-12 sell', '2026-03-16 buy', '2026-04-16 sell', '2026-05-21 buy', '2026-09-28 sell', '2026-10-13 buy',
  ]);
  assert.equal(r.summary.closed, 5);
  assert.equal(Math.round(r.summary.total), 3212);
  assert.equal(r.open.buyDate, '2026-10-13'); // posição aberta no fim
  assert.deepEqual(r.trades.map((t) => Math.round(t.pnlPct * 10) / 10), [10.8, 10.4, 3.5, -0.2, -0.9]);
});

test('formato comum do registo: lotes, 15 000 € ao fecho real, comprar e manter, sem reforços', () => {
  const r = backtest(a2a, { from: '2024-11-11' });
  const t = r.trades[0];
  assert.equal(t.lots.length, 1);
  assert.equal(t.reinforcements, 0);
  assert.equal(t.quantity, Math.floor(15000 / t.lots[0].price));
  assert.equal(t.reason, 'reversal');
  assert.ok(r.summary.buyHold.cost > 14000 && r.summary.buyHold.cost <= 15000);
  assert.equal(r.summary.peakCost, Math.max(...[...r.trades, r.open].map((x) => x.cost)));
  const st = getStrategy('e-ondas');
  assert.equal(st.execution, 'close');
  assert.equal(st.warmupYears, 1);
  assert.deepEqual(st.reasonLabels, { reversal: 'inversão' });
  assert.match(st.rules, /5% acima dele/);
});

test('sem lookahead: cortar a série numa data dá os mesmos sinais até essa data', () => {
  const full = backtest(a2a, { from: '2024-11-11' });
  const cut = '2026-02-20';
  const part = backtest(a2a.filter((q) => q.date <= cut), { from: '2024-11-11' });
  assert.deepEqual(sides(part), sides(full).filter((s) => s.slice(0, 10) <= cut));
});

test('só compra quando o fundo da correcção chegou perto da SMA200', () => {
  const up = trend(320, 0.0015);
  const peak = up.at(-1);
  const wave = (drop) => {
    const bottom = peak * (1 - drop);
    return [...up, ...ramp(peak, bottom, 12), ...ramp(bottom, bottom * 1.12, 10)];
  };
  assert.deepEqual(backtest(series(wave(0.05))).signals, []);   // correcção a mais de 3 % da SMA200: não compra
  assert.equal(backtest(series(wave(0.25))).signals[0].side, 'buy'); // correcção até à SMA200: compra
});

test('com a SMA200 a descer não compra', () => {
  const down = trend(320, -0.0015);
  const bottom = down.at(-1) * 0.9;
  const r = backtest(series([...down, ...ramp(down.at(-1), bottom, 8), ...ramp(bottom, bottom * 1.15, 10)]));
  assert.deepEqual(r.signals, []);
});

test('vende quando o fecho cai 4 % abaixo do máximo, mas só depois de o máximo ter chegado a +4 % sobre a compra', () => {
  const up = trend(320, 0.0015);
  const peak = up.at(-1);
  const bottom = peak * 0.75;
  const base = [...up, ...ramp(peak, bottom, 12)];
  const buyAt = bottom * 1.055;
  // Sobe 5,5 % (compra) e cai logo 5 %: o máximo nunca chegou a +4 % sobre a compra → não vende.
  const noSell = backtest(series([...base, buyAt, buyAt * 0.95, buyAt * 0.94]));
  assert.deepEqual(sides(noSell).map((s) => s.slice(11)), ['buy']);
  assert.ok(noSell.open);
  // Sobe mais 6 % depois da compra e cai 5 %: vende.
  const sells = backtest(series([...base, buyAt, buyAt * 1.03, buyAt * 1.06, buyAt * 1.06 * 0.95]));
  assert.deepEqual(sides(sells).map((s) => s.slice(11)), ['buy', 'sell']);
  assert.equal(sells.open, null);
  assert.ok(sells.trades[0].pnl > 0);
});

test('opções: valida chaves e valores; os parâmetros por omissão são os da especificação', () => {
  assert.deepEqual(
    [DEFAULT_OPTIONS.budget, DEFAULT_OPTIONS.up, DEFAULT_OPTIONS.down, DEFAULT_OPTIONS.minGain, DEFAULT_OPTIONS.minDip, DEFAULT_OPTIONS.near200],
    [15000, 0.05, 0.04, 0.04, 0.03, 0.03],
  );
  assert.throws(() => resolveOptions({ stop: 0.1 }), /desconhecida/);
  assert.throws(() => resolveOptions({ up: -1 }), /não negativo/);
  assert.throws(() => resolveOptions({ from: '11-11-2024' }), /AAAA-MM-DD/);
  assert.deepEqual(backtest([], {}).trades, []);
});
