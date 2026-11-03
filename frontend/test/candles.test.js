import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjustedOhlc } from '../src/lib/candles.js';

test('aplica o factor adjClose/close à abertura, ao máximo e ao mínimo', () => {
  const v = adjustedOhlc({ open: '10', high: '12', low: '9', close: '11', adjClose: '5.5' });
  assert.deepEqual(v, { o: 5, c: 5.5, h: 6, l: 4.5 });
});

test('sem ajuste (adjClose = close) mantém os preços reais', () => {
  assert.deepEqual(adjustedOhlc({ open: 10, high: 12, low: 9, close: 11, adjClose: 11 }), { o: 10, c: 11, h: 12, l: 9 });
});

test('cotações sem abertura, máximo ou mínimo usam o fecho', () => {
  assert.deepEqual(adjustedOhlc({ open: null, high: null, low: null, close: '8', adjClose: '8' }), { o: 8, c: 8, h: 8, l: 8 });
});

test('o máximo e o mínimo incluem sempre o corpo da vela', () => {
  const v = adjustedOhlc({ open: 10, high: 10.5, low: 10.2, close: 11, adjClose: 11 }); // dados inconsistentes do fornecedor
  assert.equal(v.h, 11);
  assert.equal(v.l, 10);
});
