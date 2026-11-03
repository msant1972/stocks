import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmWaitMs, defaultLimit, expiryText, normaliseLimit } from '../src/lib/saxo.js';

test('validade do token', () => {
  const now = Date.parse('2026-11-04T10:00:00Z');
  assert.equal(expiryText('2026-11-04T15:20:30Z', now), 'expira em 5 h 20 min');
  assert.equal(expiryText('2026-11-04T10:12:00Z', now), 'expira em 12 min');
  assert.equal(expiryText('2026-11-04T10:00:10Z', now), 'expira em 1 min');
  assert.equal(expiryText('2026-11-04T09:59:00Z', now), 'expirou');
  assert.equal(expiryText(null, now), null);
});

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
});

test('espera até 1,1 s entre a pré-validação e o envio', () => {
  assert.equal(confirmWaitMs(1000, 1300), 800);
  assert.equal(confirmWaitMs(1000, 5000), 0);
});
