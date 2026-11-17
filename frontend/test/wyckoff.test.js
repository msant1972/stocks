import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OPTIONS, PHASES, phase, phaseAt, prepareSeries, sessionsNeeded } from '../../shared/wyckoff.js';
import { PHASE_INFO, PHASE_ORDER, phaseLabel, phaseOptions, phaseRank, rangeNote } from '../src/lib/wyckoff.js';
import { SORT_DEFAULT_DIR, sortInstruments } from '../src/lib/instrumentSort.js';

/** Dias úteis a partir de 2025-01-01. */
function days(n) {
  const d = new Date('2025-01-01T00:00:00Z');
  const out = [];
  while (out.length < n) {
    if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const N = 320;
const DAYS = days(N);
const wobble = (i, amp = 0.004) => 1 + amp * Math.sin(i * 1.7) + amp * 0.5 * Math.sin(i * 0.37);
/** Cotações a partir de uma função do nível (sem oscilação) em cada sessão; o volume pode depender do sentido do dia. */
function quotesOf(level, { volume = () => 1e6, adjFactor = 1 } = {}) {
  let prev = null;
  return DAYS.map((date, i) => {
    const close = level(i) * wobble(i);
    const open = prev ?? close;
    const q = { date, open, high: Math.max(open, close), low: Math.min(open, close), close, adjClose: close * adjFactor, volume: volume(close > (prev ?? close)) };
    prev = close;
    return q;
  });
}
// Quatro percursos: queda e faixa em baixo; subida e faixa em cima; subida regular; queda regular.
const ramp = (i, a, b, from, to) => (i <= from ? a : i >= to ? b : a + ((b - a) * (i - from)) / (to - from));
const ACCUMULATION = quotesOf((i) => ramp(i, 100, 62, 180, 260), { volume: (up) => (up ? 2e6 : 1e6) });
const DISTRIBUTION = quotesOf((i) => ramp(i, 100, 150, 180, 260), { volume: (up) => (up ? 1e6 : 2e6) });
const MARKUP = quotesOf((i) => 100 * 1.003 ** i);
const MARKDOWN = quotesOf((i) => 100 * 0.997 ** i);
const FLAT = quotesOf(() => 100);

test('as quatro fases e a indefinida, em percursos construídos', () => {
  assert.deepEqual(PHASES, ['accumulation', 'markup', 'distribution', 'markdown', 'undefined']);
  const acc = phase(ACCUMULATION);
  assert.equal(acc.phase, 'accumulation');
  assert.equal(acc.lateral, true);
  assert.ok(acc.position < 1 / 3);
  assert.ok(acc.volumeBias > 0.2); // mais volume nos dias de subida
  assert.ok(acc.rangeSessions >= DEFAULT_OPTIONS.window && acc.rangeSessions <= 62); // a faixa começou na sessão 260
  const dist = phase(DISTRIBUTION);
  assert.equal(dist.phase, 'distribution');
  assert.ok(dist.position > 2 / 3);
  assert.ok(dist.volumeBias < -0.2);
  const up = phase(MARKUP);
  assert.equal(up.phase, 'markup');
  assert.equal(up.lateral, false);
  assert.equal(up.rangeSessions, null);
  assert.equal(phase(MARKDOWN).phase, 'markdown');
  // Faixa lateral a meio do intervalo de 52 semanas: nem acumulação nem distribuição.
  const flat = phase(FLAT);
  assert.equal(flat.phase, 'undefined');
  assert.equal(flat.lateral, true);
});

test('acumulação e distribuição exigem a queda ou a subida antes', () => {
  // Faixa em baixo depois de uma queda de só 10 %: não chega para acumulação.
  const small = quotesOf((i) => ramp(i, 100, 90, 180, 260));
  assert.equal(phase(small).phase, 'undefined');
  assert.equal(phase(small, { ...DEFAULT_OPTIONS, minDrop: 0.05 }).phase, 'accumulation');
  // Faixa em cima depois de uma subida de só 10 %.
  const little = quotesOf((i) => ramp(i, 100, 110, 180, 260));
  assert.equal(phase(little).phase, 'undefined');
  assert.equal(phase(little, { ...DEFAULT_OPTIONS, minRise: 0.05 }).phase, 'distribution');
});

test('suporte e resistência: os fechos extremos da janela, a preços de hoje (não ajustados)', () => {
  const p = phase(ACCUMULATION);
  const closes = ACCUMULATION.slice(-DEFAULT_OPTIONS.window).map((q) => q.close);
  assert.ok(Math.abs(p.support - Math.min(...closes)) < 1e-9);
  assert.ok(Math.abs(p.resistance - Math.max(...closes)) < 1e-9);
  assert.ok(Math.abs(p.width - (Math.max(...closes) / Math.min(...closes) - 1)) < 1e-9);
  // Com fecho ajustado a metade (dividendos, desdobramentos), a fase e os níveis a preços de hoje não mudam.
  const adjusted = phase(quotesOf((i) => ramp(i, 100, 62, 180, 260), { adjFactor: 0.5 }));
  assert.equal(adjusted.phase, 'accumulation');
  assert.ok(Math.abs(adjusted.support - p.support) < 1e-9);
  assert.ok(Math.abs(adjusted.resistance - p.resistance) < 1e-9);
});

test('sem lookahead e histórico mínimo', () => {
  const s = prepareSeries(DISTRIBUTION);
  for (const i of [252, 270, 300, 319]) assert.deepEqual(phaseAt(s, i), phase(DISTRIBUTION.slice(0, i + 1)));
  assert.equal(sessionsNeeded(), 253);
  assert.equal(phaseAt(s, 251), null);
  assert.equal(phase(DISTRIBUTION.slice(0, 252)), null);
  assert.equal(phase([]), null);
  // A meio da subida ainda não é distribuição.
  assert.equal(phaseAt(s, 255).phase, 'markup');
});

test('interface: etiquetas, ordem do ciclo, filtro e nota da faixa', () => {
  assert.deepEqual(PHASE_ORDER, PHASES);
  for (const p of PHASES) { assert.ok(PHASE_INFO[p].label); assert.ok(PHASE_INFO[p].help.length > 40); }
  assert.equal(phaseLabel('distribution'), 'Faixa no topo');
  assert.equal(phaseLabel('x'), '—');
  assert.deepEqual([phaseRank('accumulation'), phaseRank('markdown'), phaseRank('undefined'), phaseRank(undefined)], [0, 3, 4, null]);
  assert.deepEqual(phaseOptions().map((o) => o.value), ['all', ...PHASES]);
  assert.equal(phaseOptions({ markup: 7 })[2].label, 'Subida (7)');
  assert.equal(phaseOptions({ markup: 7 })[1].label, 'Faixa no fundo (0)');
  assert.equal(rangeNote({ lateral: true, rangeSessions: 55, volumeBias: 0.3 }), 'Em faixa há 55 sessões; mais volume nos dias de subida.');
  assert.match(rangeNote({ lateral: true, rangeSessions: 40, volumeBias: -0.3 }), /dias de queda/);
  assert.match(rangeNote({ lateral: true, rangeSessions: 40, volumeBias: 0 }), /equilibrado/);
  assert.equal(rangeNote({ lateral: false, rangeSessions: null, volumeBias: 0.3 }), '');
  assert.equal(rangeNote(undefined), '');
});

test('Acompanhar: ordenar pela fase segue o ciclo e deixa no fim quem não tem fase', () => {
  assert.equal(SORT_DEFAULT_DIR.phase, 'asc');
  const items = [{ id: 1, symbol: 'A' }, { id: 2, symbol: 'B' }, { id: 3, symbol: 'C' }, { id: 4, symbol: 'D' }];
  const phases = new Map([[1, { phase: 'markdown' }], [2, { phase: 'accumulation' }], [4, { phase: 'markup' }]]);
  assert.deepEqual(sortInstruments(items, { key: 'phase', dir: 'asc' }, { phases }).map((i) => i.symbol), ['B', 'D', 'A', 'C']);
  assert.deepEqual(sortInstruments(items, { key: 'phase', dir: 'desc' }, { phases }).map((i) => i.symbol), ['A', 'D', 'B', 'C']);
});
