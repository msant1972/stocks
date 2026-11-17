import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveMap, effectiveStrategy } from '../../shared/strategies/choice.js';

const on = (ids) => (id) => ids.includes(id);
const ALL = on(['a-momentum', 'c-ai', 'f-mergulho']);

test('estratégia do instrumento: a escolhida manda; «Nenhuma» é uma escolha', () => {
  const best = { strategyId: 'f-mergulho', total: 26860 };
  assert.deepEqual(effectiveStrategy({ choice: 'a-momentum', best, isEnabled: ALL }), { strategyId: 'a-momentum', source: 'chosen' });
  assert.deepEqual(effectiveStrategy({ choice: null, best, isEnabled: ALL }), { strategyId: null, source: 'none' });
});

test('sem escolha vale a melhor, se ganhar e estiver ligada', () => {
  assert.deepEqual(effectiveStrategy({ choice: undefined, best: { strategyId: 'f-mergulho', total: 10 }, isEnabled: ALL }), { strategyId: 'f-mergulho', source: 'best' });
  assert.deepEqual(effectiveStrategy({ choice: undefined, best: { strategyId: 'f-mergulho', total: -5 }, isEnabled: ALL }), { strategyId: null, source: 'unset' });
  assert.deepEqual(effectiveStrategy({ choice: undefined, best: undefined, isEnabled: ALL }), { strategyId: null, source: 'unset' });
  assert.deepEqual(effectiveStrategy({ choice: undefined, best: { strategyId: 'l-macd', total: 10 }, isEnabled: ALL }), { strategyId: null, source: 'unset' });
});

test('a escolhida desligada em Definições: volta a valer a melhor', () => {
  assert.deepEqual(effectiveStrategy({ choice: 'l-macd', best: { strategyId: 'c-ai', total: 10 }, isEnabled: ALL }), { strategyId: 'c-ai', source: 'best' });
});

test('mapa de vários instrumentos', () => {
  const m = effectiveMap(new Set([1, 2, 3, 4]), {
    choices: new Map([[1, 'a-momentum'], [2, null]]),
    best: new Map([[1, { strategyId: 'f-mergulho', total: 9 }], [3, { strategyId: 'c-ai', total: 5 }], [4, { strategyId: 'c-ai', total: -1 }]]),
    isEnabled: ALL,
  });
  assert.deepEqual([...m], [[1, 'a-momentum'], [2, null], [3, 'c-ai'], [4, null]]);
});
