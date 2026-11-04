import assert from 'node:assert/strict';
import { test } from 'node:test';
import { axisMoney, bigMoney, pctOf, rangePosition, ratio, shortSummary } from '../src/lib/company.js';

const n = (s) => s.replace(/\s/g, ' '); // o Intl usa espaços não separáveis

test('valores grandes em mil milhões e milhões', () => {
  assert.equal(n(bigMoney(14347606016)), '14,3 mil milhões €');
  assert.equal(n(bigMoney(850.24e6)), '850,2 milhões €');
  assert.equal(n(bigMoney(-1.5e9, 'USD')), '-1,5 mil milhões US$');
  assert.equal(n(bigMoney(12345)), '12 345 €');
  assert.equal(bigMoney(null), '—');
});

test('eixo compacto', () => {
  assert.equal(n(axisMoney(21311e6)), '21 mM');
  assert.equal(n(axisMoney(1.12e9)), '1,1 mM');
  assert.equal(n(axisMoney(850e6)), '850 M');
});

test('percentagens e rácios', () => {
  assert.equal(n(pctOf(0.04278)), '4,28 %');
  assert.equal(n(pctOf(3.4, { fraction: false })), '3,40 %');
  assert.equal(pctOf(undefined), '—');
  assert.equal(ratio(14.078014), '14,08');
  assert.equal(ratio(-3, { negativeIsNa: true }), 'n.s.');
  assert.equal(ratio(null), '—');
});

test('posição no intervalo de 52 semanas', () => {
  assert.equal(rangePosition(18.57, 13.96, 23.18), (18.57 - 13.96) / (23.18 - 13.96));
  assert.equal(rangePosition(30, 13.96, 23.18), 1);
  assert.equal(rangePosition(10, 13.96, 23.18), 0);
  assert.equal(rangePosition(10, 5, 5), null);
  assert.equal(rangePosition(null, 1, 2), null);
});

test('resumo curto corta numa frase', () => {
  assert.deepEqual(shortSummary('Curto.'), { text: 'Curto.', cut: false });
  const long = `${'A primeira frase é longa o suficiente. '.repeat(5)}E mais texto ainda`;
  const s = shortSummary(long, 120);
  assert.equal(s.cut, true);
  assert.ok(s.text.endsWith('.…'));
  assert.ok(s.text.length <= 122);
});
