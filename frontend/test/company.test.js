import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  axisMoney, bigMoney, forwardPeLabel, metricValue, pctOf, peerPosition, rangePosition, ratio, shortSummary, signedPctOf, verdictSentence,
} from '../src/lib/company.js';

const n = (s) => s.replace(/\s/g, ' '); // o Intl usa espaços não separáveis

test('valores grandes em mil milhões e milhões', () => {
  assert.equal(n(bigMoney(14347606016)), '14,3 mil milhões €');
  assert.equal(n(bigMoney(9.4412e12)), '9,44 biliões €');
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

test('frase do veredicto da valorização', () => {
  assert.equal(verdictSentence({ verdict: 'cheap', cheap: 2, expensive: 0, fair: 1, total: 3 }), 'Barato em 2 de 3 critérios.');
  assert.equal(verdictSentence({ verdict: 'expensive', cheap: 1, expensive: 3, fair: 0, total: 4 }), 'Caro em 3 de 4 critérios; barato em 1.');
  assert.equal(verdictSentence({ verdict: 'fair', cheap: 1, expensive: 1, fair: 2, total: 4 }), 'Sem maioria: 1 barato, 1 caro, 2 em linha (de 4).');
  assert.match(verdictSentence({ verdict: 'insufficient' }), /menos de dois/);
});

test('percentagens com sinal, posição no sector e valores dos indicadores', () => {
  assert.equal(n(signedPctOf(0.184)), '+18,4 %');
  assert.equal(n(signedPctOf(-0.05)), '−5,0 %');
  assert.equal(signedPctOf(null), '—');
  assert.equal(peerPosition(0.78, 31), 'mais barato do que 78 % das 31 empresas do sector');
  assert.equal(peerPosition(0.1, 31), 'mais caro do que 90 % das 31 empresas do sector');
  assert.equal(n(metricValue('pe', 14.078)), '14,1×');
  assert.equal(n(metricValue('dividendYield', 3.4)), '3,4 %');
  assert.equal(metricValue('pb', null), '—');
});

test('título do P/E estimado com o ano fiscal', () => {
  assert.equal(forwardPeLabel(2027), 'P/E (estimado 2027)');
  assert.equal(forwardPeLabel(null), 'P/E (estimado)');
});
