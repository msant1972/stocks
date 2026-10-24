import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backtest, DEFAULT_OPTIONS, resolveOptions } from '../../shared/strategies/c-ai.js';
import { atrWilder, m2Series, prepare } from '../../shared/strategies/b-opus.js';

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

/** Tendência de alta suave: abre ao fecho anterior, máximo e mínimo a ±0,5%. */
function uptrend(n, { growth = 1.0015, adj = 1 } = {}) {
  return weekdays(n).map((date, k) => {
    const c = 50 * growth ** k * (1 + 0.002 * Math.sin(k));
    return { date, open: c, high: c * 1.005, low: c * 0.995, close: c, adjClose: c * adj, volume: 1_000_000 };
  });
}

const signalIdx = (q, date) => q.findIndex((x) => x.date === date);

test('opções por omissão e validação', () => {
  assert.deepEqual(
    [DEFAULT_OPTIONS.budget, DEFAULT_OPTIONS.stopMult, DEFAULT_OPTIONS.addOnGain, DEFAULT_OPTIONS.addMinM2, DEFAULT_OPTIONS.maxAdds],
    [15000, 5, 0.1, 2, 5],
  );
  assert.throws(() => resolveOptions({ cooldown: 1 }), /desconhecida/);
  assert.throws(() => resolveOptions({ stopMult: -1 }), /stopMult/);
  assert.throws(() => resolveOptions({ from: '24-01-01' }), /from/);
});

test('entrada: compra na abertura seguinte quando C > SMA200 e M2 > 0, com 15 000 € e stop inicial de 5 × ATR', () => {
  const q = uptrend(320, { adj: 0.5 });
  const r = backtest(q);
  const buy = r.signals[0];
  assert.equal(buy.side, 'buy');
  const i = signalIdx(q, buy.date);
  const { bars } = prepare(q);
  const C = bars.map((b) => b.C);
  const m2 = m2Series(C, 252, 21);
  const atr = atrWilder(bars, 22);
  const sma200 = C.slice(i - 200, i).reduce((s, v) => s + v, 0) / 200;
  assert.ok(C[i - 1] > sma200 && m2[i - 1] > 0, 'a sessão anterior cumpria as condições');
  assert.ok(i - 1 >= 252, 'só depois das 253 sessões de aquecimento');
  const pos = r.open ?? r.trades[0];
  assert.ok(Math.abs(pos.lots[0].price - q[i].open) < 1e-9, 'preço real da abertura');
  assert.equal(pos.lots[0].quantity, Math.floor(15000 / q[i].open));
  // Stop inicial (em preços reais) = abertura − 5 × ATR do dia do sinal.
  assert.ok(Math.abs(pos.initialStop - (bars[i].O - 5 * atr[i - 1]) / bars[i].f) < 1e-9);
});

test('saída só pelo stop: intradiário ao preço do stop, com gap à abertura; chandelier nunca desce; reentra sem arrefecimento', () => {
  const base = uptrend(360);
  const e = signalIdx(base, backtest(base).signals[0].date);
  const a = base.map((x) => ({ ...x }));
  a[e + 3] = { ...a[e + 3], low: a[e + 3].close * 0.5 };
  const ra = backtest(a);
  const ta = ra.trades[0];
  assert.deepEqual([ta.sellDate, ta.reason], [a[e + 3].date, 'stop']);
  assert.ok(ta.sellPrice > a[e + 3].low && ta.sellPrice < a[e + 3].open);
  // Reentrada: volta a comprar na sessão seguinte à venda (as condições continuam válidas).
  const rebuy = ra.signals.find((x) => x.side === 'buy' && x.date > ta.sellDate);
  assert.equal(signalIdx(a, rebuy.date), e + 4);

  const g = base.map((x) => ({ ...x }));
  g[e + 3] = { ...g[e + 3], open: g[e + 3].close * 0.6, low: g[e + 3].close * 0.6 };
  const tg = backtest(g).trades[0];
  assert.deepEqual([tg.sellDate, tg.sellPrice], [g[e + 3].date, g[e + 3].close * 0.6]);

  const stops = [];
  for (let n = e + 2; n < 360; n += 4) { const o = backtest(base.slice(0, n)).open; if (o) stops.push(o.stop); }
  for (let k = 1; k < stops.length; k++) assert.ok(stops[k] >= stops[k - 1] - 1e-9);
  // Em tendência regular, sem tocar no stop, não há outras saídas.
  assert.equal(backtest(base).trades.length, 0);
});

test('reforços: só com fecho > último lote + 10% e M2 > 2, na abertura seguinte, até 5', () => {
  const q = uptrend(330).map((x, i) => {
    if (i < 256) return x;
    const c = x.close * 1.015 ** (i - 256);
    return { ...x, open: c, close: c, adjClose: c, high: c * 1.004, low: c * 0.996 };
  });
  const r = backtest(q);
  const pos = r.open ?? r.trades[0];
  assert.ok(pos.lots.length > 1, 'reforçou');
  assert.ok(pos.lots.length <= 6, 'no máximo 5 reforços');
  const { bars } = prepare(q);
  const m2 = m2Series(bars.map((b) => b.C), 252, 21);
  for (let k = 1; k < pos.lots.length; k++) {
    const idx = signalIdx(q, pos.lots[k].date);
    assert.ok(q[idx - 1].close > pos.lots[k - 1].price * 1.1, 'fecho anterior acima de +10% do último lote');
    assert.ok(m2[idx - 1] > 2, 'momentum forte no dia da decisão');
    assert.ok(Math.abs(pos.lots[k].price - q[idx].open) < 1e-9);
  }
  assert.equal(r.summary.reinforcements, pos.lots.length - 1);
  // Com M2 mínimo inatingível ou addOnGain 0, não há reforços.
  assert.equal(backtest(q, { addMinM2: 1000 }).summary.reinforcements, 0);
  assert.equal(backtest(q, { addOnGain: 0 }).summary.reinforcements, 0);
  assert.ok(backtest(q, { maxAdds: 1 }).summary.reinforcements <= 1);
  // A venda pelo stop vende todos os lotes.
  const crash = q.map((x) => ({ ...x }));
  crash[325] = { ...crash[325], low: crash[325].close * 0.4 };
  const t = backtest(crash.slice(0, 327)).trades.at(-1);
  assert.equal(t.quantity, t.lots.reduce((s, l) => s + l.quantity, 0));
});

test('respeita «from», sem lookahead, determinismo e formato comum', () => {
  const q = uptrend(420).map((x, i) => (i % 31 === 0 ? { ...x, low: x.close * 0.85 } : x));
  assert.ok(backtest(q, { from: q[350].date }).signals[0].date > q[350].date);
  assert.equal(backtest(q, { from: '2099-01-01' }).signals.length, 0);
  assert.equal(backtest(q, { from: '2099-01-01' }).firstDate, null);
  const full = backtest(q);
  for (const cut of [300, 360, 410]) {
    const before = (r) => r.signals.filter((s) => s.date < q[cut - 1].date);
    assert.deepEqual(before(backtest(q.slice(0, cut))), before(full));
  }
  assert.deepEqual(backtest(q), full);
  for (const k of ['trades', 'open', 'signals', 'firstDate', 'summary']) assert.ok(k in full);
  for (const k of ['closed', 'wins', 'reinforcements', 'peakCost', 'realized', 'unrealized', 'total', 'totalPct', 'buyHold']) assert.ok(k in full.summary);
  const realized = full.trades.reduce((s, t) => s + t.pnl, 0);
  assert.ok(Math.abs(full.summary.total - realized - (full.open?.pnl ?? 0)) < 0.02);
});
