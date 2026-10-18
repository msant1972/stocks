import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backtest, sessionStates } from '../src/lib/strategy.js';

// Constrói sessões com SMA10/SMA200 sempre definida e a direcção indicada (true sobe, false desce).
// As duas primeiras sessões nunca têm estado conhecido, qualquer que seja o valor indicado.
function fixture(states, prices) {
  const mom = states.map((s) => ({ wave: 1, rising: s === true }));
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
  const p = [10, 10, 10, 9.5, 10, 11, 12, 12.5, 13];
  const { quotes, mom } = fixture(s, p);
  assert.deepEqual(sessionStates(mom), [null, null, false, true, true, true, false, false, true]);
  const r = backtest(quotes, mom);
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.deepEqual([t.buyDate, t.buyPrice, t.quantity, t.cost], ['2026-01-05', 10, 1500, 15000]);
  assert.deepEqual([t.sellDate, t.sellPrice, t.proceeds, t.pnl], ['2026-01-08', 12.5, 18750, 3750]);
  assert.equal(r.open, null);
  assert.deepEqual(r.signals.map((x) => x.side), ['buy', 'sell']);
  assert.equal(r.summary.total, 3750);
  assert.equal(r.summary.wins, 1);
});

test('posição aberta no fim é valorizada ao último fecho e não compra duas vezes', () => {
  const s = [null, null, false, true, true, false, true, true];
  const p = [7, 7, 7, 7, 7, 7.5, 8, 8];
  const { quotes, mom } = fixture(s, p);
  const r = backtest(quotes, mom);
  assert.equal(r.trades.length, 0);
  assert.equal(r.signals.length, 1); // o segundo padrão de compra é ignorado com posição aberta
  assert.deepEqual([r.open.quantity, r.open.cost, r.open.value, r.open.pnl], [2142, 14994, 17136, 2142]);
  assert.equal(r.summary.buyHold.startDate, '2026-01-03');
});
