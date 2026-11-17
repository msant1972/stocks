import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startError } from '../src/lib/startDate.js';

test('data de início: vazia é válida; tem de estar entre a primeira data possível e a véspera da última sessão', () => {
  const limits = { minStart: '2021-02-15', latestSession: '2026-11-16' };
  assert.equal(startError('', limits), null);
  assert.equal(startError('2026-01-01', limits), null);
  assert.equal(startError('2021-02-15', limits), null);
  assert.match(startError('2020-12-31', limits), /antes de 15\/02\/2021/);
  assert.match(startError('2026-11-16', limits), /anterior à última sessão \(16\/11\/2026\)/);
  assert.equal(startError('01/01/2026', limits), 'Data inválida.');
  assert.equal(startError('2026-01-01', { minStart: null, latestSession: null }), null); // sem limites ainda: deixa a API decidir
});
