import test from 'node:test';
import assert from 'node:assert/strict';
import { lisbonMinutes, sessionEnded } from '../src/lib/format.js';

test('sessão terminada a partir das 16h30 de Lisboa (inverno e verão)', () => {
  assert.equal(lisbonMinutes(new Date('2026-11-12T16:22:00Z')), 16 * 60 + 22);
  assert.equal(sessionEnded(new Date('2026-11-12T16:22:00Z')), false);
  assert.equal(sessionEnded(new Date('2026-11-12T17:38:00Z')), true);
  assert.equal(sessionEnded(new Date('2026-07-10T15:20:00Z')), false); // 16h20 em Lisboa (UTC+1)
  assert.equal(sessionEnded(new Date('2026-07-10T15:40:00Z')), true);  // 16h40
});
