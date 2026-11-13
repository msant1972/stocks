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

test('A2A.MI com os parâmetros do protótipo (+5 % / −4 %, sem limite de tempo): as mesmas 6 compras e 5 vendas, +3 212 €', () => {
  const r = backtest(a2a, { from: '2024-11-11', up: 0.05, down: 0.04, maxHold: 0 });
  assert.deepEqual(sides(r), [
    '2025-04-14 buy', '2025-06-20 sell', '2025-09-30 buy', '2025-11-12 sell', '2026-01-07 buy',
    '2026-02-12 sell', '2026-03-16 buy', '2026-04-16 sell', '2026-05-21 buy', '2026-09-28 sell', '2026-10-13 buy',
  ]);
  assert.equal(r.summary.closed, 5);
  assert.equal(Math.round(r.summary.total), 3212);
  assert.equal(r.open.buyDate, '2026-10-13'); // posição aberta no fim
  assert.deepEqual(r.trades.map((t) => Math.round(t.pnlPct * 10) / 10), [10.8, 10.4, 3.5, -0.2, -0.9]);
});

test('A2A.MI com as regras em vigor (+3 % / −6 %, limite de 120 sessões): 5 compras e 5 vendas, +3 273 €', () => {
  const r = backtest(a2a, { from: '2024-11-11' });
  assert.deepEqual(sides(r), [
    '2025-04-10 buy', '2025-07-07 sell', '2025-08-20 buy', '2025-11-12 sell', '2026-01-07 buy',
    '2026-02-16 sell', '2026-03-10 buy', '2026-04-29 sell', '2026-04-30 buy', '2026-10-16 sell',
  ]);
  assert.equal(r.trades.at(-1).reason, 'time'); // a última compra nunca chegou a +4 %: vendida pelo limite de tempo
  assert.equal(Math.round(r.summary.total), 3273);
  assert.equal(r.open, null);
  assert.deepEqual(r.trades.map((t) => Math.round(t.pnlPct * 10) / 10), [12.4, 12.5, 0.5, -2.1, -1.6]);
});

test('formato comum do registo: lotes, 15 000 € ao fecho real, comprar e manter, sem reforços', () => {
  const r = backtest(a2a, { from: '2024-11-11' });
  const t = r.trades[0];
  assert.equal(t.lots.length, 1);
  assert.equal(t.reinforcements, 0);
  assert.equal(t.quantity, Math.floor(15000 / t.lots[0].price));
  assert.equal(t.reason, 'reversal');
  assert.ok(r.summary.buyHold.cost > 14000 && r.summary.buyHold.cost <= 15000);
  assert.equal(r.summary.peakCost, Math.max(...[...r.trades, r.open].filter(Boolean).map((x) => x.cost)));
  const st = getStrategy('e-ondas');
  assert.equal(st.execution, 'close');
  assert.equal(st.warmupYears, 1);
  assert.deepEqual(st.reasonLabels, { reversal: 'inversão', time: 'limite de tempo' });
  assert.match(st.rules, /120 sessões/);
  assert.match(st.rules, /3% acima dele/);
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

test('vende quando o fecho cai 6 % abaixo do máximo, mas só depois de o máximo ter chegado a +4 % sobre a compra', () => {
  const up = trend(320, 0.0015);
  const peak = up.at(-1);
  const bottom = peak * 0.75;
  const base = [...up, ...ramp(peak, bottom, 12)];
  const buyAt = bottom * 1.055;
  // Sobe 5,5 % (compra) e cai logo 5 %: o máximo nunca chegou a +4 % sobre a compra → não vende.
  const noSell = backtest(series([...base, buyAt, buyAt * 0.95, buyAt * 0.94]));
  assert.deepEqual(sides(noSell).map((s) => s.slice(11)), ['buy']);
  assert.ok(noSell.open);
  // Sobe mais 6 % depois da compra e cai 5 % (não chega: a venda pede 6 %); sobe 12 % e cai 7 %: vende.
  assert.ok(backtest(series([...base, buyAt, buyAt * 1.03, buyAt * 1.06, buyAt * 1.06 * 0.95])).open);
  const sells = backtest(series([...base, buyAt, buyAt * 1.06, buyAt * 1.12, buyAt * 1.12 * 0.93]));
  assert.deepEqual(sides(sells).map((s) => s.slice(11)), ['buy', 'sell']);
  assert.equal(sells.open, null);
  assert.ok(sells.trades[0].pnl > 0);
});

test('opções: valida chaves e valores; os parâmetros por omissão são os da especificação', () => {
  assert.deepEqual(
    [DEFAULT_OPTIONS.budget, DEFAULT_OPTIONS.up, DEFAULT_OPTIONS.down, DEFAULT_OPTIONS.minGain, DEFAULT_OPTIONS.minDip, DEFAULT_OPTIONS.near200],
    [15000, 0.03, 0.06, 0.04, 0.03, 0.03],
  );
  assert.throws(() => resolveOptions({ stop: 0.1 }), /desconhecida/);
  assert.throws(() => resolveOptions({ up: -1 }), /não negativo/);
  assert.throws(() => resolveOptions({ from: '11-11-2024' }), /AAAA-MM-DD/);
  assert.deepEqual(backtest([], {}).trades, []);
});

test('limite de tempo: sem chegar a +4 % em 120 sessões, vende; depois de lá chegar, só a inversão vende', () => {
  // Tendência de subida, correcção até à SMA200 e compra a +5 % do fundo; depois o preço fica parado (sem +4 %).
  const up = trend(320, 0.0015);
  const peak = up.at(-1);
  const bottom = peak * 0.84;
  const entry = [...up, ...ramp(peak, bottom, 12), ...ramp(bottom, bottom * 1.06, 6)];
  const flat = Array.from({ length: 140 }, () => bottom * 1.06);
  const r = backtest(series([...entry, ...flat]));
  const buy = r.signals.find((s) => s.side === 'buy');
  assert.ok(buy, 'compra depois da correcção');
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].reason, 'time');
  const all = series([...entry, ...flat]);
  const held = all.findIndex((q) => q.date === r.trades[0].sellDate) - all.findIndex((q) => q.date === buy.date);
  assert.equal(held, DEFAULT_OPTIONS.maxHold);
  // Sem limite (maxHold 0), a posição fica aberta.
  assert.equal(backtest(series([...entry, ...flat]), { maxHold: 0 }).open?.buyDate, buy.date);
  // Se o máximo chegou a +4 %, o limite não se aplica: a posição mantém-se enquanto não cair 4 % do máximo.
  const high = bottom * 1.06 * 1.05;
  const held2 = backtest(series([...entry, ...ramp(bottom * 1.06, high, 5), ...Array.from({ length: 140 }, () => high * 0.98)]));
  assert.equal(held2.trades.length, 0);
  assert.ok(held2.open);
});
