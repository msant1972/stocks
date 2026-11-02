import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backtest, DEFAULT_OPTIONS, resolveOptions, rsiWilder, zScore } from '../../shared/strategies/d-reversao.js';
import { getStrategy } from '../../shared/strategies/index.js';

/** Dias úteis consecutivos a partir de 2023-01-02. */
function weekdays(n) {
  const out = [];
  const d = new Date('2023-01-02T00:00:00Z');
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Série a partir de fechos: abre ao fecho anterior, máximo e mínimo a ±0,5%; adj = fecho ajustado ÷ fecho. */
function series(closes, { adj = 1 } = {}) {
  const dates = weekdays(closes.length);
  return closes.map((c, k) => {
    const open = k ? closes[k - 1] : c;
    return { date: dates[k], open, high: Math.max(open, c) * 1.005, low: Math.min(open, c) * 0.995, close: c, adjClose: c * adj, volume: 1_000_000 };
  });
}

/** 40 sessões estáveis à volta de 50 €, uma queda brusca para 45 € e depois os fechos dados. */
const flat = (n = 40) => Array.from({ length: n }, (_, k) => 50 + 0.1 * Math.sin(k));
const withDrop = (after) => series([...flat(), 45, ...after]);

test('opções por omissão e validação', () => {
  assert.deepEqual(
    [DEFAULT_OPTIONS.budget, DEFAULT_OPTIONS.meanN, DEFAULT_OPTIONS.zEntry, DEFAULT_OPTIONS.rsiN, DEFAULT_OPTIONS.rsiExit, DEFAULT_OPTIONS.maxHold],
    [15000, 20, -2.5, 2, 70, 10],
  );
  assert.throws(() => resolveOptions({ stopMult: 1 }), /desconhecida/);
  assert.throws(() => resolveOptions({ maxHold: -1 }), /maxHold/);
  assert.throws(() => resolveOptions({ from: '24-01-01' }), /from/);
  assert.equal(resolveOptions({ zEntry: -3 }).zEntry, -3);
});

test('indicadores: RSI de Wilder e z face à média de n sessões', () => {
  assert.deepEqual(rsiWilder([1, 2, 3], 2).map((v) => v && Math.round(v)), [null, null, 100]);
  assert.equal(Math.round(rsiWilder([3, 2, 1], 2)[2]), 0);
  const z = zScore([1, 2, 3, 4], 4);
  assert.equal(z[2], null);
  assert.ok(Math.abs(z[3] - (4 - 2.5) / Math.sqrt(5 / 3)) < 1e-9);
});

test('compra na abertura seguinte a uma queda com z < −2,5, com 15 000 €', () => {
  const q = withDrop([45.5, 46, 47, 48, 48.5]);
  const r = backtest(q);
  const buy = r.signals.find((s) => s.side === 'buy');
  assert.equal(buy.date, q[41].date);                 // sinal no fecho da queda (40), compra na abertura de 41
  assert.equal(buy.price, 45);                        // abertura de 41 = fecho de 40
  assert.equal(r.trades[0].quantity, Math.floor(15000 / 45));
});

/** Primeira sessão, a partir de `from`, em que o RSI2 do fecho passa 70. */
const firstRebound = (q, from) => {
  const rsi = rsiWilder(q.map((x) => x.adjClose), 2);
  return rsi.findIndex((v, i) => i >= from && v > 70);
};

test('vende na abertura seguinte quando o RSI2 passa 70 (ressalto)', () => {
  const q = withDrop([45.5, 46, 47, 48, 48.5]);
  const r = backtest(q);
  const t = r.trades[0];
  const k = firstRebound(q, 41);
  assert.ok(k > 41);
  assert.equal(t.reason, 'rebound');
  assert.equal(t.sellDate, q[k + 1].date);            // sinal no fecho de k, venda na abertura de k + 1
  assert.equal(t.sellPrice, q[k].close);              // abertura de k + 1 = fecho de k
  assert.equal(r.exitReasons.rebound, 1);
});

test('sem ressalto, vende ao fim de 10 sessões (motivo tempo)', () => {
  const q = withDrop(Array.from({ length: 14 }, (_, k) => 44.5 - 0.5 * k));
  const t = backtest(q).trades[0];
  assert.equal(t.reason, 'time');
  assert.equal(t.buyDate, q[41].date);
  assert.equal(t.sellDate, q[52].date);               // 10 sessões depois da compra (fecho de 51), venda em 52
  assert.ok(t.pnl < 0);
});

test('execução a preços reais com fecho ajustado (dividendos)', () => {
  const closes = [...flat(), 45, 45.5, 46, 47, 48, 48.5];
  const q = series(closes, { adj: 0.5 });
  const r = backtest(q);
  assert.equal(r.trades[0].lots[0].price, 45);        // preço real, não o ajustado (22,5)
  assert.equal(r.trades[0].sellPrice, q[firstRebound(q, 41)].close);
});

test('respeita from e não olha para o futuro', () => {
  const q = withDrop([45.5, 46, 47, 48, 48.5]);
  assert.equal(backtest(q, { from: q[42].date }).trades.length, 0);   // a queda é anterior a from
  const short = backtest(q.slice(0, 44));
  const long = backtest(q);
  assert.deepEqual(short.trades, long.trades.slice(0, short.trades.length));
});

test('formato comum do registo, com comparação com comprar e manter', () => {
  const q = withDrop([45.5, 46, 47, 48, 48.5]);
  const r = getStrategy('d-reversao').run(q, {});
  for (const k of ['closed', 'wins', 'reinforcements', 'peakCost', 'realized', 'unrealized', 'total', 'totalPct', 'buyHold']) assert.ok(k in r.summary, k);
  assert.equal(r.summary.closed, 1);
  assert.equal(r.summary.reinforcements, 0);
  assert.equal(r.open, null);
  assert.ok(r.summary.buyHold.startDate);
  assert.equal(r.firstDate, q[19].date);              // primeira sessão com média de 20 sessões
});
