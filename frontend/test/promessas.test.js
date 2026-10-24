import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eligible, features, rank, SESSIONS_NEEDED, TOP_N, WEIGHTS } from '../../shared/promessas.js';

function series(n, f) {
  const out = [];
  const d = new Date('2023-01-02T00:00:00Z');
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      const k = out.length;
      const c = f(k);
      out.push({ date: d.toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, adjClose: c, volume: 1000 });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

test('parâmetros validados: pesos, top 30 e histórico mínimo', () => {
  assert.deepEqual(WEIGHTS, { m2: 2, vol63: -1, s200slope: 1 });
  assert.equal(TOP_N, 30);
  assert.equal(SESSIONS_NEEDED, 316);
  assert.equal(features(series(SESSIONS_NEEDED - 1, () => 10)), null);
});

test('sinais: subida regular dá M2, inclinação e rendimentos positivos e é elegível; queda não é', () => {
  const up = features(series(400, (k) => 50 * 1.002 ** k * (1 + 0.01 * Math.sin(k))));
  assert.ok(up.m2 > 0 && up.s200slope > 0 && up.r63 > 0 && up.r252 > 0);
  assert.ok(up.aboveS200 && up.s50AboveS200);
  assert.ok(up.vol63 > 0 && up.distHigh <= 0);
  assert.equal(eligible(up), true);
  const down = features(series(400, (k) => 50 * 0.998 ** k * (1 + 0.01 * Math.sin(k))));
  assert.equal(eligible(down), false);
  // Tendência longa de subida mas queda nos últimos 3 meses: não é elegível (r63 < 0).
  const fading = features(series(400, (k) => (k < 337 ? 50 * 1.003 ** k : 50 * 1.003 ** 337 * 0.999 ** (k - 337))));
  assert.ok(fading.r63 < 0);
  assert.equal(eligible(fading), false);
});

test('ranking: percentis ponderados (M2 vale o dobro), menor volatilidade é melhor, rank só para elegíveis', () => {
  const mk = (symbol, m2, vol63, s200slope, ok = true) => ({
    symbol, features: { m2, vol63, s200slope, aboveS200: ok, s50AboveS200: ok, r63: ok ? 0.05 : -0.05 },
  });
  const out = rank([mk('A', 3, 0.2, 0.05), mk('B', 1, 0.4, 0.01), mk('C', 2, 0.1, 0.10), mk('D', 4, 0.5, 0.20, false)]);
  const by = Object.fromEntries(out.map((r) => [r.symbol, r]));
  // A: M2 2.º (2/3), vol 2.ª menor (2/3), inclinação 2.ª menor (1/3) → (2·2/3 + 2/3 + 1/3) / 4 = 58,3
  assert.equal(by.A.score, 58.3);
  assert.equal(by.D.eligible, false);
  assert.equal(by.D.rank, null);
  // C: M2 3.º (1/3), menor volatilidade (1), inclinação 2.ª (2/3) → (2·1/3 + 1 + 2/3) / 4 = 58,3: empate com A, desfeito pelo símbolo.
  assert.equal(by.C.score, 58.3);
  assert.deepEqual(out.filter((r) => r.eligible).map((r) => r.symbol), ['A', 'C', 'B']);
  assert.deepEqual(out.filter((r) => r.eligible).map((r) => r.rank), [1, 2, 3]);
  assert.equal(by.D.score > by.A.score, true); // pontuado no catálogo inteiro, mas não elegível
});
