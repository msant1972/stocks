import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmWaitMs, defaultLimit, normaliseLimit } from '../src/lib/saxo.js';

test('preço limite: aceita vírgula, recusa vazio, zero e lixo', () => {
  assert.equal(normaliseLimit('9,5'), '9.5');
  assert.equal(normaliseLimit(' 10 '), '10');
  assert.equal(normaliseLimit('0.123456'), '0.123456');
  for (const bad of ['', '0', '-1', 'abc', '1.1234567', '1e3', null]) assert.equal(normaliseLimit(bad), null, String(bad));
});

test('preço limite inicial = último preço sem zeros à direita', () => {
  assert.equal(defaultLimit('10.000000'), '10');
  assert.equal(defaultLimit('15.285000'), '15.285');
  assert.equal(defaultLimit(null), '');
  assert.equal(defaultLimit('30.459999'), '30.46');
  assert.equal(defaultLimit(107.199997), '107.2');
  assert.equal(defaultLimit('0.1234567'), '0.1235');
});

test('espera até 1,1 s entre a pré-validação e o envio', () => {
  assert.equal(confirmWaitMs(1000, 1300), 800);
  assert.equal(confirmWaitMs(1000, 5000), 0);
});
