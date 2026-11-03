import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetQuantity } from '../src/lib/trade.js';

test('as unidades inteiras que cabem em 15 000 €', () => {
  assert.equal(budgetQuantity(20), 750);
  assert.equal(budgetQuantity('16.00'), 937);        // 15 000 / 16 = 937,5 → 937
  assert.equal(budgetQuantity(2.38), 6302);
});

test('no mínimo 1 unidade, mesmo com preços acima do orçamento', () => {
  assert.equal(budgetQuantity(20000), 1);
});

test('sem preço conhecido, 1 unidade', () => {
  assert.equal(budgetQuantity(null), 1);
  assert.equal(budgetQuantity(undefined), 1);
  assert.equal(budgetQuantity('abc'), 1);
  assert.equal(budgetQuantity(0), 1);
});

test('aceita outro orçamento', () => {
  assert.equal(budgetQuantity(50, 1000), 20);
});
