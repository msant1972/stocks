import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fundamentalScores, metrics, percentiles } from '../../shared/fundamentals.js';

const row = (id, over = {}) => ({ instrumentId: id, symbol: `S${id}`, name: `E${id}`, trailingPe: 10, marketCap: 1000, freeCashflow: 100, returnOnEquity: 0.15, profitMargin: 0.1, debtToEquity: 50, currency: 'EUR', financialCurrency: 'EUR', ...over });

test('indicadores: rendimento dos resultados, do fluxo de caixa, ROE, margem e dívida (menor = melhor)', () => {
  const m = metrics(row(1));
  assert.equal(m.earningsYield, 0.1);
  assert.equal(m.fcfYield, 0.1);
  assert.equal(m.roe, 0.15);
  assert.equal(m.leverage, -50);
  // resultados negativos, moeda diferente e dívida negativa não fazem sentido
  assert.equal(metrics(row(2, { trailingPe: -5 })).earningsYield, null);
  assert.equal(metrics(row(3, { financialCurrency: 'USD' })).fcfYield, null);
  assert.equal(metrics(row(4, { debtToEquity: -1 })).leverage, null);
  assert.equal(metrics(row(5, { marketCap: null })).fcfYield, null);
});

test('percentis: empates pela média e nulos mantêm-se', () => {
  assert.deepEqual(percentiles([10, null, 30, 20]), [0, null, 1, 0.5]);
  assert.deepEqual(percentiles([5, 5, 9]), [0.25, 0.25, 1]);
  assert.deepEqual(percentiles([7]), [0.5]);
  assert.deepEqual(percentiles([null, null]), [null, null]);
});

test('pontuação: a empresa barata, rentável e pouco endividada fica em 1.º; faltam campos a mais → fora', () => {
  const rows = [
    row(1, { trailingPe: 8, freeCashflow: 200, returnOnEquity: 0.25, profitMargin: 0.2, debtToEquity: 20 }),
    row(2),
    row(3, { trailingPe: 40, freeCashflow: 10, returnOnEquity: 0.05, profitMargin: 0.02, debtToEquity: 200 }),
    row(4, { trailingPe: null, freeCashflow: null, returnOnEquity: null }), // só 2 de 5 indicadores
  ];
  const r = fundamentalScores(rows);
  assert.deepEqual(r.map((x) => x.symbol), ['S1', 'S2', 'S3']);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3]);
  assert.ok(r[0].score > r[1].score && r[1].score > r[2].score);
  assert.ok(r[0].value > 0.9 && r[0].quality > 0.9);
  assert.equal(fundamentalScores(rows, { minFields: 2 }).length, 4);
});
