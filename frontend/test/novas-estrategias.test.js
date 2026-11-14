import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { getStrategy } from '../../shared/strategies/index.js';
import * as G from '../../shared/strategies/g-donchian.js';
import * as H from '../../shared/strategies/h-cruzamento.js';
import * as I from '../../shared/strategies/i-maximo52.js';
import * as J from '../../shared/strategies/j-bollinger.js';
import * as K from '../../shared/strategies/k-keltner.js';
import * as L from '../../shared/strategies/l-macd.js';
import { ema, rollingMax, rollingMin } from '../../shared/strategies/single.js';

const asml = JSON.parse(fs.readFileSync(new URL('./fixtures/asml-as.json', import.meta.url), 'utf8'));

/** Série diária (dias úteis) a partir de fechos: abertura = fecho anterior; o fecho ajustado é igual ao fecho. */
const series = (closes, start = '2023-01-02') => {
  const d = new Date(`${start}T00:00:00Z`);
  return closes.map((c, i) => {
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    const date = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    const o = i ? closes[i - 1] : c;
    return { date, open: o, high: Math.max(o, c) * 1.002, low: Math.min(o, c) * 0.998, close: c, adjClose: c, volume: 1000 };
  });
};
const flat = (n, v = 100) => Array.from({ length: n }, () => v);
const ramp = (from, to, n) => Array.from({ length: n }, (_, k) => from + ((to - from) * (k + 1)) / n);

test('indicadores auxiliares: EMA, máximo e mínimo móveis com atraso', () => {
  const e = ema([1, 2, 3, 4, 5, 6], 3);
  assert.deepEqual(e.slice(0, 2), [null, null]);
  assert.equal(e[2], 2);
  assert.equal(e[3], 3); // 4 × 0,5 + 2 × 0,5
  assert.deepEqual(rollingMax([1, 5, 3, 4], 2, 1), [null, null, 5, 5]); // só as sessões anteriores
  assert.deepEqual(rollingMin([4, 1, 3, 2], 2, 0), [null, 1, 1, 2]);
});

test('G-Donchian: compra a rotura do máximo de 55 sessões, vende abaixo do mínimo de 20, na abertura seguinte', () => {
  const closes = [...flat(80), ...ramp(100, 130, 30), ...ramp(130, 100, 30)];
  const r = G.backtest(series(closes));
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.reason, 'channel');
  assert.ok(t.buyDate > series(closes)[80].date); // só depois da rotura
  assert.equal(r.signals.map((s) => s.side).join(), 'buy,sell');
  assert.equal(getStrategy('g-donchian').execution, 'open');
});

test('H-Cruzamento: compra no «golden cross» e vende no «death cross»', () => {
  const closes = [...ramp(200, 100, 220), ...ramp(100, 200, 160), ...ramp(200, 100, 160)];
  const r = H.backtest(series(closes));
  assert.deepEqual(r.signals.map((s) => s.side), ['buy', 'sell']);
  assert.equal(r.trades[0].reason, 'cross');
  assert.ok(r.trades[0].buyDate < r.trades[0].sellDate);
});

test('I-Máximo52: compra perto do máximo anual e vende 10 % abaixo dele', () => {
  const closes = [...ramp(100, 200, 280), ...ramp(200, 150, 40)];
  const r = I.backtest(series(closes));
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].reason, 'drawdown');
  assert.ok(r.trades[0].sellPrice <= 200 * 0.92); // vendeu depois de cair mais de 10 % do máximo
});

test('J-Bollinger: compra abaixo da banda inferior e vende no regresso à média; ao fim de maxHold sessões vende por tempo', () => {
  const noise = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i) * 0.4);
  const rebound = [...noise, 94, ...ramp(94, 101, 8), ...noise.slice(0, 20)];
  const r = J.backtest(series(rebound));
  assert.ok(r.trades.some((t) => t.reason === 'mean' && t.pnl > 0));
  const stuck = [...noise, 94, ...flat(40, 94)];
  assert.ok(J.backtest(series(stuck), { maxHold: 8 }).trades.some((t) => t.reason === 'time')); // com a banda a descer, a média só chega depois
});

test('K-Keltner: compra a rotura da banda superior (EMA + 2 ATR) e vende abaixo da EMA', () => {
  const closes = [...Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 0.3), ...ramp(100, 125, 12), ...ramp(125, 95, 25)];
  const r = K.backtest(series(closes), { n: 20, k: 2 }); // o canal clássico; os valores por omissão são os afinados
  assert.deepEqual(r.signals.map((s) => s.side), ['buy', 'sell']);
  assert.equal(r.trades[0].reason, 'middle');
});

test('L-MACD: compra quando o MACD cruza acima do sinal e vende quando cruza abaixo', () => {
  const closes = [...flat(40), ...ramp(100, 140, 40), ...ramp(140, 100, 40)];
  const r = L.backtest(series(closes));
  assert.ok(r.signals.length >= 2);
  assert.equal(r.signals[0].side, 'buy');
  assert.equal(r.signals[1].side, 'sell');
  assert.equal(r.trades[0].reason, 'cross');
});

test('formato comum e sem lookahead em todas as novas (série real da ASML.AS)', () => {
  for (const [id, mod] of [['g-donchian', G], ['h-cruzamento', H], ['i-maximo52', I], ['j-bollinger', J], ['k-keltner', K], ['l-macd', L]]) {
    const st = getStrategy(id);
    assert.equal(st.available, true, id);
    assert.equal(st.execution, 'open');
    assert.equal(st.warmupYears, 1);
    const r = st.run(asml, { from: '2024-11-13' });
    for (const t of r.trades) {
      assert.equal(t.quantity, t.lots.reduce((s, l) => s + l.quantity, 0), id);
      assert.equal(t.lots[0].quantity, Math.floor(15000 / t.lots[0].price), id);
      assert.ok(t.buyDate < t.sellDate, id);
      assert.ok(Object.keys(st.reasonLabels).includes(t.reason), `${id}: motivo ${t.reason}`);
    }
    assert.equal(r.summary.closed, r.trades.length);
    assert.ok(r.summary.buyHold.cost > 14000);
    const cut = '2026-03-02';
    const part = st.run(asml.filter((q) => q.date <= cut), { from: '2024-11-13' });
    const key = (x) => `${x.date} ${x.side}`;
    assert.deepEqual(part.signals.map(key), r.signals.filter((s) => s.date <= cut).map(key), `${id}: sinais até ${cut}`);
    assert.deepEqual(mod.resolveOptions({}).budget, 15000);
  }
});

test('valores por omissão: os afinados a 14 nov. 2026 (G, I, J, K) e os clássicos (H, L)', () => {
  assert.deepEqual([G.DEFAULT_OPTIONS.entryN, G.DEFAULT_OPTIONS.exitN], [30, 40]);
  assert.deepEqual([I.DEFAULT_OPTIONS.lookback, I.DEFAULT_OPTIONS.enter, I.DEFAULT_OPTIONS.exit], [126, 0.1, 0.15]);
  assert.deepEqual([J.DEFAULT_OPTIONS.n, J.DEFAULT_OPTIONS.k, J.DEFAULT_OPTIONS.maxHold], [40, 1.5, 80]);
  assert.deepEqual([K.DEFAULT_OPTIONS.n, K.DEFAULT_OPTIONS.atrN, K.DEFAULT_OPTIONS.k], [120, 10, 1]);
  assert.deepEqual([H.DEFAULT_OPTIONS.fast, H.DEFAULT_OPTIONS.slow], [50, 200]);
  assert.deepEqual([L.DEFAULT_OPTIONS.fast, L.DEFAULT_OPTIONS.slow, L.DEFAULT_OPTIONS.signal], [12, 26, 9]);
  assert.match(getStrategy('g-donchian').summary, /30 sessões.*40/);
});

test('opções: valida chaves e valores', () => {
  assert.throws(() => G.resolveOptions({ x: 1 }), /desconhecida/);
  assert.throws(() => H.resolveOptions({ fast: -1 }), /não negativo/);
  assert.throws(() => L.resolveOptions({ from: '1/1/2024' }), /AAAA-MM-DD/);
  assert.deepEqual(K.backtest([], {}).trades, []);
});
