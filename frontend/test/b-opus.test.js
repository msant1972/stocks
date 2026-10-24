import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  atrWilder, backtest, DEFAULT_OPTIONS, efficiencyRatio, isoWeekKey, m2Series, ORIGINAL_OPTIONS, prepare, resolveOptions, reviewFlags,
} from '../../shared/strategies/b-opus.js';

/** Dias úteis consecutivos a partir de 2023-01-02 (segunda-feira). */
function weekdays(n, start = '2023-01-02') {
  const out = [];
  const d = new Date(`${start}T00:00:00Z`);
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Série em tendência de alta suave (elegível para a B-Opus a partir do aquecimento): fecho = abertura,
 * máximo e mínimo a ±0,5%, volume alto (liquidez), fecho ajustado = fecho × adj.
 */
function uptrend(n, { adj = 1 } = {}) {
  return weekdays(n).map((date, k) => {
    const c = 50 * 1.0015 ** k * (1 + 0.002 * Math.sin(k));
    return { date, open: c, high: c * 1.005, low: c * 0.995, close: c, adjClose: c * adj, volume: 1_000_000 };
  });
}

const setBar = (quotes, i, fields) => { quotes[i] = { ...quotes[i], ...fields }; };

test('ajustamento: OHLC multiplicados por adjClose/close; execução e resultado em preços reais', () => {
  const { bars } = prepare([{ date: '2026-01-02', open: 10, high: 11, low: 9, close: 10, adjClose: 8, volume: 5 }]);
  assert.deepEqual([bars[0].O, bars[0].H, bars[0].L, bars[0].C, bars[0].f, bars[0].closeRaw], [8, 8.8, 7.2, 8, 0.8, 10]);
  const q = uptrend(320, { adj: 0.5 });
  const r = backtest(q);
  const t = r.trades[0] ?? r.open;
  const buyBar = q.find((x) => x.date === t.buyDate);
  assert.ok(Math.abs(t.lots[0].price - buyBar.open) < 1e-9); // preço real da abertura, não o ajustado
  assert.equal(t.quantity, Math.floor(15000 / buyBar.open));
});

test('ATR de Wilder, Efficiency Ratio e M2 com valores calculados à mão', () => {
  const bars = [10, 11, 12, 11, 13].map((c, i) => ({ H: c + 1, L: c - 1, C: c }));
  // TR: 2, max(2,|12−10|,|10−10|)=2, 2, max(2,|12−12|,|10−12|)=2, max(2,|14−11|,|12−11|)=3
  assert.deepEqual(atrWilder(bars, 3), [null, null, 2, 2, 2 + (3 - 2) / 3]);
  // |13 − 11| / (|12−11| + |11−12| + |13−11|) = 2 / 4
  assert.deepEqual(efficiencyRatio([10, 11, 12, 11, 13], 3), [null, null, null, 1 / 3, 0.5]);
  assert.deepEqual(efficiencyRatio([5, 5, 5], 2), [null, null, 0]);
  // M2 com lookback 3, skip 1: (C[t−1] / C[t−3] − 1) / (desvio dos 3 últimos retornos × √252)
  const closes = [100, 110, 99, 108.9, 119.79];
  const m2 = m2Series(closes, 3, 1);
  const rets = [0.1, -0.1, 0.1];
  const mean = 0.1 / 3;
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / 2);
  assert.ok(Math.abs(m2[3] - (99 / 100 - 1) / (sd * Math.sqrt(252))) < 1e-12);
  assert.equal(m2[2], null);
});

test('revisões: última sessão de cada semana ISO; feriado à sexta passa para quinta; mensal e quinzenal', () => {
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01');
  assert.equal(isoWeekKey('2024-12-30'), '2025-W01');
  const dates = ['2026-01-05', '2026-01-06', '2026-01-08', '2026-01-12', '2026-01-16'];
  assert.deepEqual(reviewFlags(dates, 'weekly'), [false, false, true, false, true]); // 16 é sexta (última sessão)
  assert.deepEqual(reviewFlags(['2026-01-12', '2026-01-14'], 'weekly'), [false, false]); // quarta: semana por acabar
  assert.deepEqual(reviewFlags(['2026-01-29', '2026-01-30', '2026-02-02'], 'monthly'), [false, true, false]);
  const fridays = weekdays(20).map((d) => d); // 4 semanas completas
  assert.deepEqual(reviewFlags(fridays, 'biweekly').map((f, i) => (f ? i : null)).filter((x) => x != null), [4, 14]);
});

test('compra na abertura seguinte a uma revisão elegível, com 15 000 €, e começa só depois do aquecimento e de «from»', () => {
  const q = uptrend(320);
  const r = backtest(q);
  const buy = r.signals[0];
  assert.equal(buy.side, 'buy');
  const idx = q.findIndex((x) => x.date === buy.date);
  assert.ok(idx > 252);
  assert.equal(reviewFlags(q.map((x) => x.date), 'weekly')[idx - 1], true); // a sessão anterior foi revisão
  assert.equal(r.summary.reinforcements, 0);
  const later = backtest(q, { from: q[300].date });
  assert.ok(later.signals[0].date > q[300].date);
  assert.equal(later.firstDate, q[300].date);
  assert.equal(backtest(q, { from: '2099-01-01' }).signals.length, 0);
});

test('stop intradiário, stop com gap na abertura e chandelier que nunca desce', () => {
  const base = uptrend(330);
  const r0 = backtest(base);
  const e = base.findIndex((x) => x.date === r0.signals[0].date);
  // Mínimo muito baixo duas sessões depois da compra → vende ao preço do stop.
  const a = base.map((x) => ({ ...x }));
  setBar(a, e + 2, { low: a[e + 2].close * 0.5 });
  const ra = backtest(a);
  const ta = ra.trades[0];
  assert.deepEqual([ta.sellDate, ta.reason], [a[e + 2].date, 'stop']);
  assert.ok(ta.sellPrice > a[e + 2].close * 0.5 && ta.sellPrice < a[e + 2].open);
  // Abertura abaixo do stop → vende à abertura.
  const b = base.map((x) => ({ ...x }));
  setBar(b, e + 2, { open: b[e + 2].close * 0.6, low: b[e + 2].close * 0.6 });
  const tb = backtest(b).trades[0];
  assert.deepEqual([tb.sellDate, tb.reason, tb.sellPrice], [b[e + 2].date, 'stop', b[e + 2].close * 0.6]);
  // Chandelier: o stop da posição aberta é sempre o máximo dos valores calculados até à data.
  const stops = [];
  for (let n = e + 1; n < 330; n += 3) { const o = backtest(base.slice(0, n)).open; if (o) stops.push(o.stop); }
  for (let k = 1; k < stops.length; k++) assert.ok(stops[k] >= stops[k - 1] - 1e-9);
});

test('protecção contra gaps cancela a compra; arrefecimento de 10 sessões depois de um stop', () => {
  const base = uptrend(360);
  const e = base.findIndex((x) => x.date === backtest(base).signals[0].date);
  const g = base.map((x) => ({ ...x }));
  setBar(g, e, { open: g[e - 1].close * 1.2, high: g[e - 1].close * 1.2 });
  const rg = backtest(g);
  assert.equal(rg.gapCancels, 1);
  assert.notEqual(rg.signals[0].date, g[e].date);

  const s = base.map((x) => ({ ...x }));
  setBar(s, e + 1, { low: s[e + 1].close * 0.5 });
  const rs = backtest(s);
  const stopIdx = s.findIndex((x) => x.date === rs.trades[0].sellDate);
  const next = rs.signals.find((x) => x.side === 'buy' && x.date > rs.trades[0].sellDate);
  assert.ok(next, 'volta a comprar depois do arrefecimento');
  assert.ok(s.findIndex((x) => x.date === next.date) - stopIdx > 10);
  assert.ok(rs.blocked.cooldown > 0);
});

test('saídas semanais: stop temporal e quebra de tendência, vendidas na abertura seguinte', () => {
  const base = uptrend(400);
  const e = base.findIndex((x) => x.date === backtest(base).signals[0].date);
  // Preço parado depois da compra: sem ganho de 1 ATR em 20 sessões → stop temporal.
  const flat = base.map((x, i) => (i < e ? x : { ...x, open: base[e].open, close: base[e].open, adjClose: base[e].open, high: base[e].open * 1.001, low: base[e].open * 0.999 }));
  const rf = backtest(flat);
  const tf = rf.trades[0];
  assert.equal(tf.reason, 'time_stop');
  const sellIdx = flat.findIndex((x) => x.date === tf.sellDate);
  assert.ok(sellIdx - e >= 21);
  assert.equal(reviewFlags(flat.map((x) => x.date), 'weekly')[sellIdx - 1], true);
  assert.ok(!backtest(flat, { useTimeStop: false }).trades.some((t) => t.reason === 'time_stop'));
  // Queda lenta abaixo da SMA200 (sem tocar no stop): saída por quebra de tendência ou de momento.
  const down = base.map((x, i) => {
    if (i <= e) return x;
    const c = base[e].close * 0.9985 ** (i - e);
    return { ...x, open: c, close: c, adjClose: c, high: c * 1.0005, low: c * 0.9995 };
  });
  const td = backtest(down, { stopMult: 50, useTimeStop: false }).trades[0];
  assert.ok(['trend_break', 'momentum_loss'].includes(td.reason));
});

test('sem lookahead, determinismo e formato comum do registo', () => {
  const q = uptrend(420).map((x, i) => (i % 37 === 0 ? { ...x, low: x.close * 0.9 } : x));
  const full = backtest(q);
  for (const cut of [300, 350, 400]) {
    const part = backtest(q.slice(0, cut));
    const before = (r) => r.signals.filter((s) => s.date < q[cut - 1].date);
    assert.deepEqual(before(part), before(full));
  }
  assert.deepEqual(backtest(q), full);
  for (const k of ['trades', 'open', 'signals', 'firstDate', 'summary']) assert.ok(k in full);
  for (const k of ['closed', 'wins', 'reinforcements', 'peakCost', 'realized', 'unrealized', 'total', 'totalPct', 'buyHold']) assert.ok(k in full.summary);
  const realized = full.trades.reduce((s, t) => s + t.pnl, 0);
  assert.ok(Math.abs(full.summary.total - realized - (full.open?.pnl ?? 0)) < 0.02);
});

test('opções: desconhecidas ou inválidas dão erro; variantes correm', () => {
  assert.throws(() => resolveOptions({ capital: 1 }), /desconhecida/);
  assert.throws(() => resolveOptions({ trendStrength: 'x' }), /trendStrength/);
  assert.throws(() => resolveOptions({ stopMult: -1 }), /stopMult/);
  const q = uptrend(700);
  for (const o of [{ trendStrength: 'adx' }, { trendStrength: 'none' }, { volumeConfirmation: true }, { pullbackEntry: true },
    { overextensionBlock: true }, { partialTakeProfit: true }, { review: 'monthly' }, { review: 'biweekly' }]) {
    const r = backtest(q, o);
    assert.equal(typeof r.summary.total, 'number', JSON.stringify(o));
  }
});

test('versão B: sem filtro ER, stop de 4 × ATR e reforços a +10% até 5', () => {
  assert.deepEqual(
    [DEFAULT_OPTIONS.trendStrength, DEFAULT_OPTIONS.stopMult, DEFAULT_OPTIONS.addOnGain, DEFAULT_OPTIONS.maxAdds],
    ['none', 4, 0.1, 5],
  );
  // Subida forte e regular: reforça na abertura seguinte a cada fecho mais de 10% acima do último lote.
  const q = uptrend(330).map((x, i) => {
    if (i < 255) return x;
    const c = x.close * 1.012 ** (i - 255);
    return { ...x, open: c, close: c, adjClose: c, high: c * 1.005, low: c * 0.995 };
  });
  const r = backtest(q);
  const pos = r.open ?? r.trades[0];
  assert.ok(pos.lots.length > 1, 'reforçou');
  assert.ok(pos.lots.length <= 6, 'no máximo 5 reforços');
  for (let k = 1; k < pos.lots.length; k++) {
    const lot = pos.lots[k];
    const idx = q.findIndex((x) => x.date === lot.date);
    assert.ok(q[idx - 1].close > pos.lots[k - 1].price * 1.1, 'o fecho anterior passou +10% do último lote');
    assert.ok(Math.abs(lot.price - q[idx].open) < 1e-9, 'executado na abertura');
    assert.equal(lot.quantity, Math.floor(15000 / q[idx].open));
  }
  assert.equal(r.summary.reinforcements, pos.lots.length - 1);
  assert.equal(r.signals.filter((x) => x.side === 'add').length, pos.lots.length - 1);
  assert.equal(pos.cost, Math.round(pos.lots.reduce((s, l) => s + l.cost, 0) * 100) / 100);
  // Uma queda forte vende a posição inteira (todos os lotes) pelo stop.
  const crash = q.map((x) => ({ ...x }));
  crash[325] = { ...crash[325], low: crash[325].close * 0.5 };
  const t = backtest(crash.slice(0, 327)).trades.at(-1);
  assert.equal(t.reason, 'stop');
  assert.equal(t.quantity, t.lots.reduce((s, l) => s + l.quantity, 0));
  // Sem reforços (addOnGain 0) só há um lote.
  assert.equal((backtest(q, { addOnGain: 0 }).open ?? backtest(q, { addOnGain: 0 }).trades[0]).lots.length, 1);
  assert.equal(backtest(q, { maxAdds: 1 }).summary.reinforcements <= 1, true);
});

test('regras originais (ORIGINAL_OPTIONS), entradas diárias e stop a partir do maior fecho continuam disponíveis', () => {
  const q = uptrend(420).map((x, i) => (i % 29 === 0 ? { ...x, low: x.close * 0.93 } : x));
  const original = backtest(q, ORIGINAL_OPTIONS);
  assert.equal(original.options.trendStrength, 'er');
  assert.equal(original.summary.reinforcements, 0);
  // Entradas diárias: a primeira compra não espera pela revisão semanal (pode seguir-se a qualquer sessão).
  const daily = backtest(q, { entryReview: 'daily' });
  const weekly = backtest(q);
  assert.ok(daily.signals[0].date <= weekly.signals[0].date);
  const fromClose = backtest(q, { stopFrom: 'close' });
  assert.equal(typeof fromClose.summary.total, 'number');
});
