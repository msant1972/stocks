import assert from 'node:assert/strict';
import { test } from 'node:test';
import { momentum, niceTicks, rollingMean } from '../src/lib/momentum.js';

test('média móvel simples', () => {
  assert.deepEqual(rollingMean([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('wave = SMA10/SMA200 − 1 e wave125 = SMA8/SMA125 − 1, em %', () => {
  const quotes = Array.from({ length: 10 }, (_, i) => ({ adjClose: String(10 + i), sma10: '11', sma200: '10', sma125: '12.5' }));
  const m = momentum(quotes);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  close(m[9].wave, 10);                 // 11 / 10 − 1
  assert.equal(m[6].wave125, null);     // SMA8 indefinida antes da 8.ª sessão
  close(m[9].wave125, 24);              // SMA8 das sessões 12..19 = 15,5; 15,5 / 12,5 − 1
});

test('a subir só quando o valor excede os dois anteriores (ta.rising(wave, 2))', () => {
  const w = ['1.00', '1.02', '1.01', '1.03', '1.04', '1.035'];
  const quotes = w.map((s) => ({ adjClose: '1', sma10: s, sma200: '1' }));
  assert.deepEqual(momentum(quotes).map((m) => m.rising), [false, false, false, true, true, false]);
  assert.deepEqual(momentum([{ adjClose: '1', sma10: null, sma200: '1' }]).map((m) => m.wave), [null]);
});

test('marcas do eixo redondas e com o zero', () => {
  assert.deepEqual(niceTicks([-12.3, 25.9]), [-20, -10, 0, 10, 20, 30]);
  assert.deepEqual(niceTicks([0.4, 6.8]), [0, 2, 4, 6, 8]);
  assert.deepEqual(niceTicks([null, -3]), [-3, -2, -1, 0]);
});
