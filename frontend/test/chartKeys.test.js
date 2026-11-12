import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartShortcut } from '../src/lib/chartKeys.js';

test('1–5 escolhem o período, pela ordem dos botões', () => {
  assert.deepEqual(['1', '2', '3', '4', '5'].map((k) => chartShortcut(k)), [0, 1, 2, 3, 4].map((index) => ({ type: 'range', index })));
});

test('6–0 alternam as médias, pela ordem dos indicadores', () => {
  assert.deepEqual(['6', '7', '8', '9', '0'].map((k) => chartShortcut(k).index), [0, 1, 2, 3, 4]);
  assert.ok(['6', '7', '8', '9', '0'].every((k) => chartShortcut(k).type === 'average'));
});

test('T, V e M (com maiúsculas ou minúsculas) alternam velas, volume e momento', () => {
  assert.deepEqual(['t', 'T'].map(chartShortcut), [{ type: 'candles' }, { type: 'candles' }]);
  assert.deepEqual(['v', 'V'].map(chartShortcut), [{ type: 'volume' }, { type: 'volume' }]);
  assert.deepEqual(['r', 'R'].map(chartShortcut), [{ type: 'rsi' }, { type: 'rsi' }]);
  assert.deepEqual(['m', 'M'].map(chartShortcut), [{ type: 'momentum' }, { type: 'momentum' }]);
});

test('outras teclas não são atalhos', () => {
  assert.equal(chartShortcut('a'), null);
  assert.equal(chartShortcut('ArrowDown'), null);
  assert.equal(chartShortcut('Enter'), null);
});
