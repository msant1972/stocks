import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bargainCriteria, sortBargains } from '../src/lib/bargains.js';

const row = (symbol, cheap, total, extra = {}) => ({ symbol, cheap, total, upside: null, pe: null, ...extra });

test('critérios que dizem barato, por extenso e por ordem fixa', () => {
  assert.equal(bargainCriteria({ graham: 'cheap', sector: 'cheap', history: 'fair', analysts: null }), 'sector, Graham');
  assert.equal(bargainCriteria({ sector: 'expensive' }), '');
  assert.equal(bargainCriteria(null), '');
});

test('ordenação por critérios: mais critérios, depois maior fracção, depois margem dos analistas', () => {
  const rows = [row('A', 2, 4, { upside: 0.1 }), row('B', 3, 4), row('C', 2, 2), row('D', 2, 4, { upside: 0.3 })];
  assert.deepEqual(sortBargains(rows, { key: 'cheap', dir: 'desc' }).map((r) => r.symbol), ['B', 'C', 'D', 'A']);
});

test('valores em falta ficam no fim nos dois sentidos', () => {
  const rows = [row('A', 1, 2, { pe: 9 }), row('B', 1, 2), row('C', 1, 2, { pe: 5 })];
  assert.deepEqual(sortBargains(rows, { key: 'pe', dir: 'asc' }).map((r) => r.symbol), ['C', 'A', 'B']);
  assert.deepEqual(sortBargains(rows, { key: 'pe', dir: 'desc' }).map((r) => r.symbol), ['A', 'C', 'B']);
  assert.deepEqual(sortBargains([row('b', 1, 1), row('a', 1, 1)], { key: 'symbol', dir: 'asc' }).map((r) => r.symbol), ['a', 'b']);
});
