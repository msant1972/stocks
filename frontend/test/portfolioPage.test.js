import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bySector, pct1, reviewState, signedPct, tone } from '../src/features/portfolio/format.js';

test('percentagens: uma casa, sinal explícito e traço quando não há valor', () => {
  assert.equal(pct1(12.34).replace(/\s/g, ' '), '12,3 %');
  assert.equal(signedPct(80.07).replace(/\s/g, ' '), '+80,1 %');
  assert.equal(signedPct(-7.79).replace(/\s/g, ' '), '−7,8 %');
  assert.equal(signedPct(0).replace(/\s/g, ' '), '0,0 %');
  assert.equal(signedPct(null), '—');
  assert.deepEqual([tone(1), tone(-1), tone(0), tone(null)], ['positive', 'negative', '', '']);
});

test('carteira por sector: conta, soma os pesos e ordena pelo peso', () => {
  const rows = bySector([
    { sector: 'Energy', weight: 0.06 }, { sector: 'Utilities', weight: 0.07 }, { sector: 'Energy', weight: 0.05 }, { sector: null, weight: 0.04 },
  ]);
  assert.deepEqual(rows.map((r) => [r.sector, r.count]), [['Energy', 2], ['Utilities', 1], ['Sem sector', 1]]);
  assert.ok(Math.abs(rows[0].weight - 0.11) < 1e-12);
  assert.deepEqual(bySector([]), []);
});

test('estado da revisão: sem revisões, por executar ou executada', () => {
  assert.equal(reviewState(null), 'none');
  assert.equal(reviewState({ date: null, executed: false }), 'none');
  assert.equal(reviewState({ date: '2026-11-16', executed: false }), 'pending');
  assert.equal(reviewState({ date: '2026-11-02', executed: true }), 'done');
});
