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

test('totais mensais: meses parciais, quartis e ordem dos mais quentes', async () => {
  const { monthlyTotals } = await import('../src/lib/turnover.js');
  const points = [
    { date: '2025-01-15', value: 999 },                                     // 1.º mês sem o início: parcial
    { date: '2025-02-03', value: 10 }, { date: '2025-02-04', value: 10 },   // 20
    { date: '2025-03-03', value: 40 },                                      // 40
    { date: '2025-04-01', value: 30 },                                      // 30
    { date: '2025-05-02', value: 50 },                                      // 50
    { date: '2025-06-02', value: 7 },                                       // mês corrente: parcial
  ];
  const r = monthlyTotals(points, { today: '2025-06-02' });
  assert.deepEqual(r.map((m) => [m.month, m.value, m.partial, m.heat, m.rank]), [
    ['2025-01', 999, true, null, null],
    ['2025-02', 20, false, 1, 4],
    ['2025-03', 40, false, 3, 2],
    ['2025-04', 30, false, 2, 3],
    ['2025-05', 50, false, 4, 1],
    ['2025-06', 7, true, null, null],
  ]);
  assert.equal(r[1].perSession, 10);
  // Um primeiro mês que começa no dia 2 (dia 1 feriado) está completo.
  assert.equal(monthlyTotals([{ date: '2025-01-02', value: 1 }])[0].partial, false);
  assert.deepEqual(monthlyTotals([]), []);
});
