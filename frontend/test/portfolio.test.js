import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as promessas from '../../shared/promessas.js';
import {
  DEFAULT_OPTIONS, blockOf, featuresAt, maxDrawdown, monthsBefore, nextBlockStart, plan, prepareInstrument, ranking, resolveOptions, simulate,
} from '../../shared/strategies/portfolio.js';

/** Calendário de dias úteis a partir de 2022-01-03 (segunda-feira). */
function calendar(n, start = '2022-01-03') {
  const d = new Date(`${start}T00:00:00Z`);
  const out = [];
  while (out.length < n) {
    if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const DAYS = calendar(1000);

/** Cotações com crescimento diário g (ou drift(i)) e uma pequena oscilação, para a volatilidade não ser zero. */
function quotesOf(k, g, { drift = null, volume = 1e6 } = {}) {
  let c = 100;
  return DAYS.map((date, i) => {
    const open = c;
    c *= 1 + (typeof drift === 'function' ? drift(i) : g) + 0.004 * Math.sin(i * (k + 2));
    return { date, open, high: Math.max(open, c), low: Math.min(open, c), close: c, adjClose: c, volume };
  });
}
const inst = (id, g, { sector = 'Energy', ...rest } = {}) => prepareInstrument({ id, symbol: `S${String(id).padStart(2, '0')}`, name: `Empresa ${id}`, sector }, quotesOf(id, g, rest));
const posMap = () => new Map(DAYS.map((d, k) => [d, k]));
const row = (id, rank, sector = 'A') => ({ inst: { id, symbol: `S${id}`, sector }, rank, score: 100 - rank });

test('opções: valores por omissão e validação', () => {
  assert.deepEqual(resolveOptions(), DEFAULT_OPTIONS);
  assert.equal(DEFAULT_OPTIONS.positions, 20);
  assert.equal(DEFAULT_OPTIONS.weeks, 2);
  assert.throws(() => resolveOptions({ posicoes: 3 }), /desconhecida/);
  assert.throws(() => resolveOptions({ positions: 30, keepRank: 20 }), /keepRank/);
  assert.throws(() => resolveOptions({ weeks: 0 }), /weeks/);
});

test('blocos de duas semanas: mudam à segunda-feira, de 14 em 14 dias, e não dependem da janela', () => {
  assert.equal(blockOf('2026-11-02'), blockOf('2026-11-15')); // segunda a domingo da semana seguinte
  assert.notEqual(blockOf('2026-11-15'), blockOf('2026-11-16'));
  assert.equal(blockOf('2026-11-16') - blockOf('2026-11-02'), 1);
  assert.equal(nextBlockStart('2026-11-02'), '2026-11-16');
  assert.equal(nextBlockStart('2026-11-13'), '2026-11-16');
  assert.equal(new Date(`${nextBlockStart('2025-01-01')}T00:00:00Z`).getUTCDay(), 1);
  assert.equal(blockOf('2026-11-09', 1) - blockOf('2026-11-02', 1), 1); // semanal
  assert.equal(monthsBefore('2026-11-13', 24), '2024-11-13');
  assert.equal(monthsBefore('2026-03-31', 1), '2026-02-28');
});

test('sinais: iguais aos das Promessas na mesma sessão', () => {
  const quotes = quotesOf(3, 0.001);
  const u = prepareInstrument({ id: 1, symbol: 'S1' }, quotes);
  for (const i of [400, 715, 999]) {
    const a = featuresAt(u, i);
    const b = promessas.features(quotes.slice(0, i + 1));
    for (const k of ['m2', 'vol63', 's200slope', 'r63', 'r252', 's50over200', 'upDays63', 'liq']) assert.ok(Math.abs(a[k] - b[k]) <= 1e-9 * Math.max(1, Math.abs(b[k])), `${k} em ${i}`);
    assert.equal(a.aboveS200, b.aboveS200);
    assert.equal(a.s50AboveS200, b.s50AboveS200);
    assert.equal(a.date, b.date);
  }
  assert.equal(featuresAt(u, promessas.SESSIONS_NEEDED - 2), null);
});

test('ranking: só os elegíveis (tendência intacta e liquidez), por pontuação, com lugares seguidos', () => {
  const universe = [inst(1, 0.0010), inst(2, 0.0030), inst(3, 0.0020), inst(4, -0.0010), inst(5, 0.0025, { volume: 10 })];
  const r = ranking(universe, DAYS[700], DEFAULT_OPTIONS, posMap());
  assert.deepEqual(r.map((x) => x.inst.id), [2, 3, 1]); // o 4 desce (sem tendência); o 5 não tem liquidez
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3]);
  assert.equal(r.scored, 5);
  // Um instrumento sem cotações recentes fica fora.
  const stale = { ...universe[1], id: 9 };
  stale.dates = stale.dates.slice(0, 680);
  assert.ok(!ranking([...universe, stale], DAYS[700], DEFAULT_OPTIONS, posMap()).some((x) => x.inst.id === 9));
});

test('decisão: mantém dentro do lugar de manutenção, vende o resto e enche pelo ranking', () => {
  const o = { ...DEFAULT_OPTIONS, positions: 3, keepRank: 5, maxPerSector: 0 };
  const rows = [1, 2, 3, 4, 5, 6, 7].map((id, k) => row(id, k + 1));
  // Carteira: 4 (lugar 4, fica), 6 (lugar 6, sai por ranking) e 99 (já não é elegível, sai pelo filtro).
  const d = plan(rows, [4, 6, 99], o);
  assert.deepEqual(d.keep, [4]);
  assert.deepEqual(d.buy, [1, 2]);
  assert.deepEqual(d.sell, [{ id: 6, reason: 'ranking' }, { id: 99, reason: 'filtro' }]);
  // Carteira vazia: compra os 3 primeiros.
  assert.deepEqual(plan(rows, [], o).buy, [1, 2, 3]);
  // Sem mudanças no ranking, não há trocas.
  assert.deepEqual(plan(rows, [1, 2, 3], o), { ...plan(rows, [1, 2, 3], o), buy: [], sell: [] });
});

test('decisão: limite por sector nas compras; quem saiu dos melhores só é vendido se houver substituto que caiba', () => {
  const o = { ...DEFAULT_OPTIONS, positions: 4, keepRank: 6, maxPerSector: 2 };
  // Os 6 melhores são do sector A; o 7 e o 8 são do B; o 9 do C.
  const rows = [1, 2, 3, 4, 5, 6].map((id, k) => row(id, k + 1, 'A')).concat([row(7, 7, 'B'), row(8, 8, 'B'), row(9, 9, 'C')]);
  // Carteira vazia: 2 do A (limite), depois os melhores de outros sectores, mesmo fora do lugar de manutenção.
  const first = plan(rows, [], o);
  assert.deepEqual(first.buy, [1, 2, 7, 8]);
  // Na revisão seguinte, com o mesmo ranking, o 7 e o 8 ficam (não há substituto entre os 6 melhores que caiba no limite):
  const second = plan(rows, first.buy, o);
  assert.deepEqual(second.sell, []);
  assert.deepEqual(second.buy, []);
  assert.deepEqual([...second.keep].sort(), [1, 2, 7, 8]);
  // Nunca vende e volta a comprar o mesmo instrumento na mesma revisão.
  for (const s of second.sell) assert.ok(!second.buy.includes(s.id));
  // Se aparecer um substituto de outro sector entre os 6 melhores, entra no lugar do pior dos que estavam fora.
  const rows2 = [row(1, 1, 'A'), row(2, 2, 'A'), row(10, 3, 'D'), row(3, 4, 'A'), row(4, 5, 'A'), row(5, 6, 'A'), row(7, 7, 'B'), row(8, 8, 'B')];
  const third = plan(rows2, [1, 2, 7, 8], o);
  assert.deepEqual(third.buy, [10]);
  assert.deepEqual(third.sell, [{ id: 8, reason: 'ranking' }]);
  // Sem limite por sector, a carteira são os 4 melhores.
  assert.deepEqual(plan(rows, [], { ...o, maxPerSector: 0 }).buy, [1, 2, 3, 4]);
});

test('maior queda desde um máximo', () => {
  assert.equal(maxDrawdown([100, 110, 99, 120]), 99 / 110 - 1);
  assert.equal(maxDrawdown([100, 101, 102]), 0);
});

test('simulação: carteira dos melhores, revisões de duas em duas semanas, curva em base 100 e custos', () => {
  const sectors = ['A', 'B', 'C', 'D'];
  const universe = [];
  for (let k = 1; k <= 12; k++) universe.push(inst(k, 0.0003 * k, { sector: sectors[k % 4] }));
  const to = DAYS.at(-1);
  const from = monthsBefore(to, 24);
  const r = simulate(universe, { from, to, positions: 4, keepRank: 8, maxPerSector: 2 });
  assert.equal(r.lastDate, to);
  assert.ok(r.firstDate >= from);
  assert.equal(r.curve[0].value, 100);
  assert.equal(r.curve[0].benchmark, 100);
  assert.equal(r.positions.length, 4);
  // No máximo 2 por sector e pesos a somar a parte investida.
  const perSector = {};
  for (const p of r.positions) perSector[p.sector] = (perSector[p.sector] ?? 0) + 1;
  assert.ok(Math.max(...Object.values(perSector)) <= 2);
  assert.ok(Math.abs(r.positions.reduce((s, p) => s + p.weight, 0) - r.summary.invested) < 1e-9);
  assert.ok(r.summary.invested > 0.97);
  // Os que mais crescem ganham ao catálogo inteiro; há custos.
  assert.ok(r.summary.returnPct > r.summary.benchmarkPct);
  assert.ok(r.summary.feesPct > 0);
  assert.equal(r.summary.benchmarkInstruments, 12);
  assert.ok(Math.abs(r.curve.at(-1).value / 100 - 1 - r.summary.returnPct / 100) < 1e-12);
  // Revisões: de duas em duas semanas (24 meses ≈ 52), à segunda-feira, decididas ao fecho e executadas na sessão seguinte.
  assert.ok(r.summary.reviews >= 50 && r.summary.reviews <= 54);
  assert.equal(new Date(`${r.review.date}T00:00:00Z`).getUTCDay(), 1);
  assert.equal(r.review.executed, true);
  assert.equal(r.review.executionDate, DAYS[DAYS.indexOf(r.review.date) + 1]);
  assert.equal(r.review.next, nextBlockStart(r.review.date));
  assert.equal(r.reviews[0].date, r.review.date);
  // As listas da última revisão batem certo com a carteira.
  const ids = (l) => l.map((x) => x.instrumentId).sort((a, b) => a - b);
  assert.deepEqual(ids([...r.review.keep, ...r.review.buy]), ids(r.positions));
  for (const s of r.review.sell) assert.ok(!r.positions.some((p) => p.instrumentId === s.instrumentId));
});

test('simulação: uma revisão no último dia fica por executar e as compras trazem o peso-alvo', () => {
  const universe = [];
  for (let k = 1; k <= 8; k++) universe.push(inst(k, 0.0004 * k, { sector: `S${k}` }));
  // Termina numa segunda-feira que abre um bloco novo.
  const monday = DAYS.findLast((d, i) => i > 800 && blockOf(d) !== blockOf(DAYS[i - 1]));
  const r = simulate(universe, { from: monthsBefore(monday, 12), to: monday, positions: 3, keepRank: 3, maxPerSector: 0 });
  assert.equal(r.review.date, monday);
  assert.equal(r.review.executed, false);
  assert.equal(r.review.executionDate, null);
  // As posições ainda são as de antes da revisão: manter + vender = carteira.
  const ids = (l) => l.map((x) => x.instrumentId).sort((a, b) => a - b);
  assert.deepEqual(ids([...r.review.keep, ...r.review.sell]), ids(r.positions));
  for (const b of r.review.buy) { assert.equal(b.weight, 1 / 3); assert.equal(b.buyDate, null); }
});

test('simulação: instrumentos que perdem a tendência saem pelo filtro e, sem elegíveis, a carteira fica em numerário', () => {
  // Sobem até à sessão 700 e depois caem todos.
  const universe = [];
  for (let k = 1; k <= 6; k++) universe.push(inst(k, 0, { sector: `S${k}`, drift: (i) => (i < 700 ? 0.0005 * k : -0.004) }));
  const to = DAYS.at(-1);
  const r = simulate(universe, { from: DAYS[600], to, positions: 3, keepRank: 6 });
  assert.equal(r.positions.length, 0);
  assert.equal(r.summary.invested, 0);
  assert.ok(r.trades.length >= 3);
  assert.ok(r.trades.some((t) => t.reason === 'filtro'));
  assert.equal(r.review.eligible, 0);
  // Em numerário perde menos do que o catálogo, que continua a cair.
  assert.ok(r.summary.maxDrawdownPct > r.summary.benchmarkDrawdownPct);
  // Sem histórico nenhum: resultado vazio.
  assert.equal(simulate([], { from: DAYS[0], to }).firstDate, null);
});

test('simulação com data de início: começa vazia nesse dia e revê logo, sem esperar pelo bloco seguinte', () => {
  const universe = [];
  for (let k = 1; k <= 8; k++) universe.push(inst(k, 0.0004 * k, { sector: `S${k}` }));
  // Uma quarta-feira a meio de um bloco de duas semanas.
  const start = DAYS.find((d, i) => i > 700 && new Date(`${d}T00:00:00Z`).getUTCDay() === 3 && blockOf(d) === blockOf(DAYS[i - 2]));
  const to = DAYS.at(-1);
  const r = simulate(universe, { start, from: start, to, positions: 3, keepRank: 6, maxPerSector: 0, reviewAtStart: true });
  assert.equal(r.firstDate, start);
  assert.equal(r.curve[0].value, 100);
  assert.equal(r.curve[0].positions, 0); // vazia no primeiro dia
  assert.equal(r.reviews.at(-1).date, start); // a revisão mais antiga é a do dia de início
  assert.equal(r.curve[1].positions, 3); // comprou na abertura seguinte
  // Sem reviewAtStart, a primeira revisão só vem no bloco seguinte.
  const plain = simulate(universe, { start, from: start, to, positions: 3, keepRank: 6, maxPerSector: 0 });
  assert.notEqual(plain.reviews.at(-1).date, start);
  assert.equal(plain.curve[1].positions, 0);
});

test('carteira fixa (data de início sem revisões): compra os melhores desse dia com os dados até ele e mantém-nos até ao fim', () => {
  // O instrumento 9 só passa a ser o melhor depois da data de início: a carteira fixa não o compra; a revista sim.
  const universe = [];
  for (let k = 1; k <= 6; k++) universe.push(inst(k, 0.0004 * k, { sector: `S${k}` }));
  universe.push(inst(9, 0, { sector: 'S9', drift: (i) => (i < 850 ? 0.0001 : 0.01) }));
  const start = DAYS[800];
  const to = DAYS.at(-1);
  const fixed = simulate(universe, { start, from: start, to, positions: 3, keepRank: 6, maxPerSector: 0, reviewAtStart: true, rebalance: false });
  assert.equal(fixed.reviews.length, 1);
  assert.equal(fixed.reviews[0].date, start);
  assert.deepEqual(fixed.positions.map((p) => p.symbol).sort(), ['S04', 'S05', 'S06']); // os melhores na data de início
  assert.equal(fixed.trades.length, 0);
  assert.ok(fixed.positions.every((p) => p.buyDate === DAYS[801]));
  const revised = simulate(universe, { start, from: start, to, positions: 3, keepRank: 3, maxPerSector: 0, reviewAtStart: true });
  assert.ok(revised.positions.some((p) => p.symbol === 'S09'));
});
