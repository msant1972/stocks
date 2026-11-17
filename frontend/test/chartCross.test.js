import assert from 'node:assert/strict';
import { test } from 'node:test';

test('cruz do Charts: valor à altura do rato, a partir da área do gráfico e do domínio do eixo', async () => {
  const { valueAtY } = await import('../src/components/finance/valueAtY.js');
  const plot = { y: 8, height: 400 };
  assert.equal(valueAtY(8, plot, [60, 140]), 140);       // topo da área = máximo do eixo
  assert.equal(valueAtY(408, plot, [60, 140]), 60);      // fundo = mínimo
  assert.equal(valueAtY(208, plot, [60, 140]), 100);     // meio
  assert.equal(valueAtY(4, plot, [60, 140]), null);      // fora da área
  assert.equal(valueAtY(500, plot, [60, 140]), null);
  assert.equal(valueAtY(100, null, [60, 140]), null);
  assert.equal(valueAtY(100, plot, null), null);
});
