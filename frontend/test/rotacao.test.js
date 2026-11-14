import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OPTIONS, maxDrawdown, plan, prepareInstrument, rank, resolveOptions, simulate } from '../../shared/strategies/rotacao.js';

/** Calendário de dias úteis a partir de 2022-01-03. */
function calendar(n, start = '2022-01-03') {
  const d = new Date(`${start}T00:00:00Z`);
  const out = [];
  while (out.length < n) {
    if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const DAYS = calendar(900);
const O = { ...DEFAULT_OPTIONS, positions: 2, keepRank: 4 };

/** Instrumento com crescimento diário g a partir de 100 (abertura = fecho anterior), liquidez alta. */
function inst(id, g, { from = 0, drift = null } = {}) {
  let c = 100;
  const quotes = DAYS.map((date, i) => {
    const gi = typeof drift === 'function' ? drift(i) : g;
    const open = c;
    c *= 1 + gi;
    return { date, open, close: c, adjClose: c, volume: 1e6, i };
  }).filter((q) => q.i >= from);
  return prepareInstrument({ id, symbol: `S${id}`, name: `Empresa ${id}` }, quotes, O);
}
const posMap = (universe) => new Map([...new Set(universe.flatMap((u) => u.dates))].sort().map((d, k) => [d, k]));

test('ranking: elegíveis por momentum 12-1 decrescente; sem momentum positivo ou abaixo da SMA200 ficam fora', () => {
  const universe = [inst(1, 0.0010), inst(2, 0.0030), inst(3, 0.0020), inst(4, -0.0005), inst(5, 0.0025)];
  const d = DAYS[600];
  const r = rank(universe, d, O, posMap(universe));
  assert.deepEqual(r.map((x) => x.inst.id), [2, 5, 3, 1]); // o 4 cai sempre: momentum negativo
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3, 4]);
});

test('momentum 12-1: ignora o último mês (a subida recente não conta)', () => {
  // O instrumento 1 sobe 1 % ao dia só nas últimas 15 sessões; o 2 sobe de forma regular: o 12-1 favorece o 2.
  const universe = [inst(1, 0.0, { drift: (i) => (i >= 585 ? 0.01 : 0.0004) }), inst(2, 0.0008)];
  const r = rank(universe, DAYS[599], O, posMap(universe));
  assert.equal(r[0].inst.id, 2);
});

test('liquidez: valor negociado médio abaixo do mínimo exclui o instrumento', () => {
  const thin = prepareInstrument({ id: 9, symbol: 'POUCO', name: null }, DAYS.map((date, i) => ({ date, open: 100 * 1.002 ** i, close: 100 * 1.002 ** i, adjClose: 100 * 1.002 ** i, volume: 100 })), O);
  const universe = [inst(1, 0.001), thin];
  assert.deepEqual(rank(universe, DAYS[600], O, posMap(universe)).map((x) => x.inst.id), [1]);
});

test('plano: mantém as posições dentro de keepRank, vende as que caem, compra pelo ranking até N', () => {
  const universe = [inst(1, 0.0030), inst(2, 0.0029), inst(3, 0.0028), inst(4, 0.0027), inst(5, 0.0026), inst(6, 0.0001)];
  const d = DAYS[600];
  const pos = posMap(universe);
  // Já tem o 4 (4.º do ranking: dentro de keepRank = 4) e o 6 (6.º: fora): mantém o 4, vende o 6, compra o melhor que falta.
  const p = plan(universe, d, [4, 6], O, pos);
  assert.deepEqual(p.keep, [4]);
  assert.deepEqual(p.sell, [6]);
  assert.deepEqual(p.buy, [1]);
  // Sem posições: compra os N melhores.
  assert.deepEqual(plan(universe, d, [], O, pos).buy, [1, 2]);
});

test('simulação: compra à abertura da sessão a seguir à revisão, vende quando deixa de estar entre os melhores', () => {
  // O instrumento 1 lidera até à sessão 650 e depois cai a pique; os 2 e 3 sobem sempre.
  const universe = [
    inst(1, 0, { drift: (i) => (i < 650 ? 0.003 : -0.01) }),
    inst(2, 0.0015), inst(3, 0.0012), inst(4, 0.0001),
  ];
  const r = simulate(universe, { from: DAYS[500], to: DAYS[899], positions: 2, keepRank: 3 });
  const first = r.curve[0];
  assert.ok(first && r.rebalances.length >= 12);
  // Compras sempre no primeiro dia de um mês novo (a revisão é no último dia útil do mês anterior).
  for (const t of r.trades) assert.equal(t.buyDate.slice(8) <= '05', true);
  const t1 = r.trades.find((t) => t.symbol === 'S1');
  assert.ok(t1 && t1.reason === 'rotation' && t1.sellDate > '2023-10-01');
  assert.ok(r.open.length <= 2);
  assert.equal(r.summary.closed, r.trades.length);
  assert.ok(r.summary.peakCost > 0 && r.summary.peakCost <= 2 * 15000);
  assert.equal(r.summary.net, Math.round((r.summary.total - r.summary.costs) * 100) / 100);
  assert.equal(r.summary.buyHold.instruments, 4);
});

test('sem lookahead: cortar os dados numa data dá as mesmas operações até essa data', () => {
  const make = () => [inst(1, 0.0030, { drift: (i) => (i < 700 ? 0.003 : -0.004) }), inst(2, 0.0015), inst(3, 0.0012), inst(4, 0.0020)];
  const full = simulate(make(), { from: DAYS[500], to: DAYS[899], positions: 2, keepRank: 3 });
  const cutDay = DAYS[760];
  const cutUni = make().map((u) => prepareInstrument({ id: u.id, symbol: u.symbol, name: u.name }, u.dates.map((date, k) => ({ date, open: u.open[k], close: u.close[k], adjClose: u.adj[k], volume: 1e6 })).filter((q) => q.date <= cutDay), O));
  const part = simulate(cutUni, { from: DAYS[500], to: cutDay, positions: 2, keepRank: 3 });
  const key = (t) => `${t.symbol} ${t.buyDate} ${t.sellDate}`;
  const fullBefore = full.trades.filter((t) => t.sellDate <= cutDay).map(key);
  assert.deepEqual(part.trades.map(key), fullBefore);
});

test('próxima revisão: ranking, o que comprar, manter e vender com os últimos dados', () => {
  const universe = [inst(1, 0.0030), inst(2, 0.0020), inst(3, 0.0010), inst(4, 0.0005)];
  const r = simulate(universe, { from: DAYS[500], to: DAYS[899], positions: 2, keepRank: 3 });
  assert.equal(r.next.date, DAYS[899]);
  assert.equal(r.next.eligible, 4);
  assert.deepEqual(r.next.top.map((x) => x.symbol).slice(0, 2), ['S1', 'S2']);
  assert.equal(r.next.keep.length + r.next.buy.length, 2);
});

test('opções: valida chaves e valores', () => {
  assert.equal(resolveOptions({}).positions, 10);
  assert.throws(() => resolveOptions({ stop: 1 }), /desconhecida/);
  assert.throws(() => resolveOptions({ positions: -1 }), /não negativo/);
  assert.throws(() => resolveOptions({ positions: 10, keepRank: 5 }), /keepRank/);
  assert.deepEqual(simulate([], { from: '2025-01-01', to: '2025-12-31' }).trades, []);
});

test('queda máxima do resultado acumulado', () => {
  assert.equal(maxDrawdown([0, 10, 5, 20, 8, 30]), -12);
  assert.equal(maxDrawdown([0, -5, -3]), -5);
  assert.equal(maxDrawdown([]), 0);
});
