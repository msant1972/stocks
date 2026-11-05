import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidateLabel, comparePortfolios, confirmWaitMs, defaultLimit, defaultStop, filterMatches, normaliseLimit, orderLabel, signalsToOrders } from '../src/lib/saxo.js';

test('preço limite: aceita vírgula, recusa vazio, zero e lixo', () => {
  assert.equal(normaliseLimit('9,5'), '9.5');
  assert.equal(normaliseLimit(' 10 '), '10');
  assert.equal(normaliseLimit('0.123456'), '0.123456');
  for (const bad of ['', '0', '-1', 'abc', '1.1234567', '1e3', null]) assert.equal(normaliseLimit(bad), null, String(bad));
});

test('preço limite inicial = último preço sem zeros à direita', () => {
  assert.equal(defaultLimit('10.000000'), '10');
  assert.equal(defaultLimit('15.285000'), '15.285');
  assert.equal(defaultLimit(null), '');
  assert.equal(defaultLimit('30.459999'), '30.46');
  assert.equal(defaultLimit(107.199997), '107.2');
  assert.equal(defaultLimit('0.1234567'), '0.1235');
});

test('espera até 1,1 s entre a pré-validação e o envio', () => {
  assert.equal(confirmWaitMs(1000, 1300), 800);
  assert.equal(confirmWaitMs(1000, 5000), 0);
});

test('etiqueta da ordem', () => {
  assert.equal(orderLabel({ side: 'buy', orderType: 'limit' }), 'Compra limitada');
  assert.equal(orderLabel({ side: 'sell', orderType: 'trailing_stop' }), 'Venda stop móvel');
  assert.equal(orderLabel({ side: 'sell', orderType: 'stop' }), 'Venda stop');
});

test('stop por omissão: 8 % abaixo do preço', () => {
  assert.deepEqual(defaultStop(10), { price: '9.2', distance: '0.8' });
  assert.deepEqual(defaultStop('30.46'), { price: '28.02', distance: '2.44' });
  assert.deepEqual(defaultStop(0.5), { price: '0.46', distance: '0.04' });
  assert.deepEqual(defaultStop(null), { price: '', distance: '' });
});

test('carteira virtual lado a lado com a da SAXO', () => {
  const rows = comparePortfolios(
    [{ instrumentId: 1, symbol: 'GALP.LS', quantity: 100 }, { instrumentId: 2, symbol: 'BCP.LS', quantity: 50 }],
    [{ instrumentId: 1, symbol: 'GALP.LS', quantity: 80 }, { instrumentId: null, symbol: 'ASML:xams', quantity: 3 }],
  );
  assert.deepEqual(rows.map((r) => [r.symbol, r.virtualQty, r.saxoQty, r.diff]), [
    ['ASML:xams', 0, 3, 3], ['BCP.LS', 50, 0, -50], ['GALP.LS', 100, 80, -20],
  ]);
});

test('sinais → ordens: um por instrumento, compras ao orçamento, vendas só do que há na SAXO', () => {
  const sig = (instrumentId, symbol, side, date, lastClose) => ({ instrumentId, symbol, side, date, lastClose });
  const orders = signalsToOrders([
    sig(1, 'GALP.LS', 'buy', '2026-11-02', '15.00'), sig(1, 'GALP.LS', 'add', '2026-11-04', '16.00'),
    sig(2, 'BCP.LS', 'sell', '2026-11-04', '0.70'), sig(3, 'EDP.LS', 'sell', '2026-11-04', '4.00'),
  ], [{ instrumentId: 2, quantity: 1000 }], 15000);
  assert.deepEqual(orders.map((o) => [o.signal.symbol, o.side, o.quantity, o.skip]), [
    ['BCP.LS', 'sell', 1000, null], ['EDP.LS', 'sell', 0, 'sem posição na SAXO'], ['GALP.LS', 'buy', 937, null],
  ]);
});

test('correspondência SAXO: filtro, ordenação e texto dos candidatos', () => {
  const items = [
    { symbol: 'B.DE', name: 'Bayer', status: 'linked', saxo: { symbol: 'BAYN:xetr', description: 'Bayer AG' } },
    { symbol: 'A.PA', name: 'Alpha', status: 'unchecked', saxo: null },
    { symbol: 'C.MI', name: 'Gamma', status: 'ambiguous', saxo: null },
  ];
  assert.deepEqual(filterMatches(items).map((i) => i.symbol), ['C.MI', 'A.PA']);
  assert.deepEqual(filterMatches(items, { view: 'linked' }).map((i) => i.symbol), ['B.DE']);
  assert.deepEqual(filterMatches(items, { view: 'all', q: 'xetr' }).map((i) => i.symbol), ['B.DE']);
  assert.equal(candidateLabel({ symbol: 'BAYN:xetr', description: 'Bayer AG', exchangeId: 'FSE', currency: 'EUR', nameScore: 1 }),
    'BAYN:xetr — Bayer AG · FSE · EUR · nome 100 %');
});
