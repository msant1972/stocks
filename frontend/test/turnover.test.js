import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthLabel, monthlyAverages, peakSession } from '../src/lib/turnover.js';

const pts = [
  { date: '2026-10-30', value: 10, sma200: null },
  { date: '2026-10-31', value: 20, sma200: 12 },
  { date: '2026-11-02', value: 40, sma200: 14 },
];

test('médias mensais, com a SMA200 só dos dias que a têm', () => {
  assert.deepEqual(monthlyAverages(pts), [
    { month: '2026-10', value: 15, sma200: 12, sessions: 2 },
    { month: '2026-11', value: 40, sma200: 14, sessions: 1 },
  ]);
  assert.deepEqual(monthlyAverages([]), []);
});

test('sessão de maior valor e nome do mês', () => {
  assert.equal(peakSession(pts).date, '2026-11-02');
  assert.equal(peakSession([]), null);
  assert.equal(monthLabel('2026-11'), 'nov. 2026');
});
