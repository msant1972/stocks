import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backtest, sessionStates } from '../src/lib/strategy.js';

// Sessões com SMA10/SMA200 sempre definida (5%, fora da zona neutra) e SMA8/SMA125 a 0% (permite vender),
// salvo indicação em waves/waves125. As duas primeiras sessões nunca têm estado conhecido.
function fixture(states, prices, waves = {}, waves125 = {}) {
  const mom = states.map((s, i) => ({ wave: waves[i] ?? 5, wave125: waves125[i] ?? 0, rising: s === true }));
  const quotes = prices.map((p, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, close: String(p) }));
  return { mom, quotes };
}

test('estado só é conhecido com SMA10/SMA200 nas duas sessões anteriores', () => {
  const mom = [{ wave: 1, rising: false }, { wave: 1, rising: true }, { wave: 1, rising: true }, { wave: null, rising: false }];
  assert.deepEqual(sessionStates(mom), [null, null, true, null]);
});

test('compra após desce-sobe-sobe e vende tudo após sobe-desce-desce', () => {
  //            0     1     2      3     4     5      6      7      8
  const s = [null, null, false, true, true, true, false, false, true];
  const p = [10, 10, 10, 9.5, 10, 10.5, 10.8, 10.9, 11];
  const { quotes, mom } = fixture(s, p);
  const r = backtest(quotes, mom);
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.deepEqual([t.buyDate, t.quantity, t.cost, t.reinforcements], ['2026-01-05', 1500, 15000, 0]);
  assert.deepEqual([t.sellDate, t.sellPrice, t.proceeds, t.pnl], ['2026-01-08', 10.9, 16350, 1350]);
  assert.equal(r.open, null);
  assert.deepEqual(r.signals.map((x) => x.side), ['buy', 'sell']);
  assert.deepEqual([r.summary.total, r.summary.peakCost, r.summary.totalPct], [1350, 15000, 9]);
});

test('posição aberta no fim é valorizada ao último fecho e não compra duas vezes', () => {
  const s = [null, null, false, true, true, false, true, true];
  const p = [7, 7, 7, 7, 7, 7.2, 7.5, 7.6];
  const { quotes, mom } = fixture(s, p);
  const r = backtest(quotes, mom);
  assert.equal(r.trades.length, 0);
  assert.equal(r.signals.length, 1); // o segundo padrão de compra é ignorado com posição aberta
  assert.deepEqual([r.open.quantity, r.open.cost, r.open.value, r.open.pnl], [2142, 14994, 16279.2, 1285.2]);
  assert.equal(r.summary.buyHold.startDate, '2026-01-03');
});

test('reforça com mais 15 000 € quando o fecho sobe mais de 10% face à compra mais recente', () => {
  //            0     1     2      3     4     5     6      7      8      9
  const s = [null, null, false, true, true, true, true, true, true, true];
  const p = [10, 10, 10, 10, 10, 11, 11.01, 12, 12.11, 12.12];
  const { quotes, mom } = fixture(s, p);
  const r = backtest(quotes, mom);
  // 11 € é exactamente +10% (não ultrapassa); 11,01 € → reforço. O seguinte exige > 12,111 € (+10% sobre 11,01):
  // 12 € e 12,11 € não chegam; 12,12 € sim.
  assert.deepEqual(r.signals.map((x) => [x.date, x.side]), [
    ['2026-01-05', 'buy'], ['2026-01-07', 'add'], ['2026-01-10', 'add'],
  ]);
  const o = r.open;
  assert.equal(o.reinforcements, 2);
  assert.deepEqual(o.lots.map((l) => [l.price, l.quantity, l.cost]), [[10, 1500, 15000], [11.01, 1362, 14995.62], [12.12, 1237, 14992.44]]);
  assert.deepEqual([o.quantity, o.cost], [4099, 44988.06]);
  assert.equal(r.summary.reinforcements, 2);
  assert.equal(r.summary.peakCost, o.cost);
});

test('num dia com venda válida vende e não reforça', () => {
  const s = [null, null, false, true, true, true, false, false];
  const p = [10, 10, 10, 10, 10, 10.5, 10.6, 12]; // +20% no dia do sinal de venda
  const { quotes, mom } = fixture(s, p);
  const r = backtest(quotes, mom);
  assert.deepEqual(r.signals.map((x) => x.side), ['buy', 'sell']);
  assert.equal(r.trades[0].reinforcements, 0);
});

test('ignora sinais quando o SMA10/SMA200 está entre −1% e +1%', () => {
  const s = [null, null, false, true, true, true, false, false, false, true, true, true, false, false];
  const p = [10, 10, 10, 10, 10, 10.2, 10.3, 10.3, 10.3, 10.3, 10.3, 10.4, 10.5, 10.5];
  // compra no índice 4 com 0,5% → ignorada; compra no índice 10 (fora); venda no índice 13 com −1% (limite) → ignorada.
  const { quotes, mom } = fixture(s, p, { 4: 0.5, 13: -1 });
  const r = backtest(quotes, mom);
  assert.equal(r.skipped, 2);
  assert.deepEqual(r.signals, [{ date: '2026-01-11', side: 'buy' }]);
  assert.equal(r.open.buyDate, '2026-01-11');
});

test('só vende com o SMA8/SMA125 abaixo de 1%', () => {
  //            0     1     2      3     4     5     6      7      8     9      10
  const s = [null, null, false, true, true, true, false, false, true, false, false];
  const p = [10, 10, 10, 10, 10, 10.2, 10.3, 10.3, 10.4, 10.5, 10.5];
  // venda no índice 7 com SMA8/SMA125 em 1% (não inferior) → mantém; venda no índice 10 com 0,9% → vende.
  const { quotes, mom } = fixture(s, p, {}, { 7: 1, 10: 0.9 });
  const r = backtest(quotes, mom);
  assert.equal(r.sellsHeld, 1);
  assert.equal(r.trades.length, 1);
  assert.deepEqual([r.trades[0].sellDate, r.trades[0].sellPrice], ['2026-01-11', 10.5]);
});

test('registo de estratégias: A-Momentum disponível e igual ao backtest; B-Opus em preparação', async () => {
  const { STRATEGIES, getStrategy, DEFAULT_STRATEGY_ID } = await import('../src/lib/strategy.js');
  const { momentum } = await import('../src/lib/momentum.js');
  assert.deepEqual(STRATEGIES.map((s) => [s.id, s.name, s.available]), [['a-momentum', 'A-Momentum', true], ['b-opus', 'B-Opus', false]]);
  assert.equal(DEFAULT_STRATEGY_ID, 'a-momentum');
  assert.equal(getStrategy('b-opus'), null);
  assert.equal(getStrategy('x'), null);
  const quotes = Array.from({ length: 300 }, (_, k) => {
    const close = 50 + 10 * Math.sin(k / 15);
    return { date: `2025-${String(1 + Math.floor(k / 28) % 12).padStart(2, '0')}-${String(1 + (k % 28)).padStart(2, '0')}`, close, adjClose: close, sma10: close, sma125: 50, sma200: 50 };
  });
  assert.deepEqual(getStrategy('a-momentum').run(quotes), backtest(quotes, momentum(quotes)));
});
