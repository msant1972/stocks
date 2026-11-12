import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buyHoldCosts, custodyCost, DEFAULT_COSTS, orderCost, strategyCosts } from '../../shared/costs.js';
import { conditionParams, conditionQuery, describeConditions, readConditions, windowSummary } from '../src/lib/testConditions.js';
import { rankings } from '../src/lib/compare.js';
import { countByStatus, experimentPayload, filterExperiments } from '../src/lib/lab.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 0.005, `${a} ≈ ${b}`);

test('custos: comissão com mínimo, meio spread por ordem e custódia proporcional ao tempo', () => {
  close(orderCost(15000), 15000 * 0.0008 + 15000 * 0.0005); // 12 € de comissão + 7,50 € de meio spread
  close(orderCost(1000), 3 + 0.5); // mínimo de 3 €
  assert.equal(orderCost(0), 0);
  close(custodyCost(10000, '2025-01-01', '2026-01-01'), 15); // 0,15 % de 10 000 € num ano
  assert.equal(custodyCost(10000, '2026-01-02', '2026-01-01'), 0);
});

test('custos de uma simulação: por ano de venda, posição aberta no 2.º ano, operações com ganho depois dos custos', () => {
  const r = {
    trades: [
      { sellDate: '2025-03-01', proceeds: 15030, pnl: 30, lots: [{ date: '2025-01-01', cost: 15000 }] },
      { sellDate: '2025-12-01', proceeds: 16500, pnl: 1500, lots: [{ date: '2025-06-01', cost: 15000 }] },
    ],
    open: { lastDate: '2026-01-01', value: 15500, lots: [{ date: '2025-12-15', cost: 15000 }] },
  };
  const c = strategyCosts(r, { mid: '2025-06-30', lastDate: '2026-01-01' });
  assert.equal(c.orders, 5); // 3 compras e 2 vendas (a venda da posição aberta conta no custo, não nas ordens feitas)
  assert.equal(c.winsNet, 1); // a 1.ª (+30 €) passa a perder com os custos
  close(c.total, c.firstYear + c.secondYear);
  close(c.firstYear, 42.68); // compra 19,50 + venda 19,54 + custódia de 59 dias 3,64
  assert.ok(buyHoldCosts({ cost: 15000, value: 18000, startDate: '2024-01-01' }, '2026-01-01') > 40);
  assert.equal(buyHoldCosts(null, '2026-01-01'), null);
  assert.equal(DEFAULT_COSTS.commissionMin, 3);
});

test('condições do teste: lidas do endereço, query da API e texto', () => {
  const p = new URLSearchParams('periodo=verificacao&custos=1');
  assert.deepEqual(readConditions(p), { period: 'verification', costs: true });
  assert.deepEqual(readConditions(new URLSearchParams('')), { period: 'recent', costs: false });
  assert.deepEqual(conditionParams({ period: 'recent', costs: false }), { periodo: null, custos: null });
  assert.equal(conditionQuery({ period: 'verification', costs: true }), 'period=verification&costs=true');
  assert.match(describeConditions({ period: 'verification', costs: true }), /verificação.*custos estimados/);
  const w = windowSummary([
    { windowFrom: '2022-11-06', toDate: '2024-11-06', sessions: 512 },
    { windowFrom: '2022-11-06', toDate: '2024-11-06', sessions: 300 },
  ]);
  assert.deepEqual(w, { fromDate: '2022-11-06', toDate: '2024-11-06', instruments: 2, fullHistory: 1 });
});

test('classificação das estratégias em várias condições: posição e estabilidade', () => {
  const a = [{ id: 'a', name: 'A', returnOnPeakPct: 10 }, { id: 'b', name: 'B', returnOnPeakPct: 15 }];
  const same = rankings([a, a]);
  assert.equal(same.stable, true);
  assert.deepEqual(same.rows.map((r) => r.id), ['b', 'a']);
  const changed = rankings([a, [{ id: 'a', name: 'A', returnOnPeakPct: 5 }, { id: 'b', name: 'B', returnOnPeakPct: -2 }]]);
  assert.equal(changed.stable, false);
  assert.deepEqual(changed.rows[0].cells.map((c) => c.rank), [1, 2]);
  const ties = rankings([[{ id: 'a', name: 'A', returnOnPeakPct: 0 }, { id: 'b', name: 'B', returnOnPeakPct: 0 }], [{ id: 'b', name: 'B', returnOnPeakPct: 0 }, { id: 'a', name: 'A', returnOnPeakPct: 0 }]]);
  assert.equal(ties.stable, true); // empates partilham a posição
  assert.deepEqual(ties.rows.map((r) => r.cells[0].rank), [1, 1]);
});

test('laboratório: contagem, filtros e corpo do pedido', () => {
  const items = [
    { status: 'kept', title: 'D-Reversão', hypothesis: 'reversão à média', result: null },
    { status: 'dropped', title: 'Filtro ER', hypothesis: null, result: 'Abandonado' },
    { status: 'running', title: 'Custos', hypothesis: 'A ordem mantém-se', result: null },
  ];
  assert.deepEqual(countByStatus(items), { running: 1, idea: 0, kept: 1, dropped: 1 });
  assert.equal(filterExperiments(items, { status: 'dropped' }).length, 1);
  assert.equal(filterExperiments(items, { q: 'REVERSAO' })[0].title, 'D-Reversão'); // sem acentos nem maiúsculas
  assert.deepEqual(experimentPayload({ title: ' T ', status: 'idea', hypothesis: ' ', metric: 'm', result: '', startedOn: '', decidedOn: '2026-11-08' }),
    { title: 'T', status: 'idea', hypothesis: null, metric: 'm', result: null, startedOn: null, decidedOn: '2026-11-08' });
});

test('VT: último fecho × volume, e valor compacto para a tabela', async () => {
  const { compactMoney, lastTurnover } = await import('../src/lib/format.js');
  assert.equal(lastTurnover({ close: '19.45', volume: 1000 }), 19450);
  assert.equal(lastTurnover({ close: '19.45', volume: null }), null);
  assert.equal(lastTurnover(null), null);
  assert.equal(compactMoney(19450).replace(/\s/g, ' '), '19 k€');
  assert.equal(compactMoney(12_345_678).replace(/\s/g, ' '), '12,3 M€');
  assert.equal(compactMoney(1_250_000_000).replace(/\s/g, ' '), '1,3 mM€');
  assert.equal(compactMoney(850), '850 €');
  assert.equal(compactMoney(null), '—');
});

test('Acompanhar: ordenar pela melhor estratégia (resultado), sem cálculo no fim, e pelas outras colunas', async () => {
  const { sortInstruments, SORT_DEFAULT_DIR } = await import('../src/lib/instrumentSort.js');
  const items = [
    { id: 1, symbol: 'AAA', latest: { close: '10', volume: 100, changePct: '1' } },
    { id: 2, symbol: 'BBB', latest: { close: '1', volume: 5000, changePct: '-2' } },
    { id: 3, symbol: 'CCC', latest: null },
    { id: 4, symbol: 'DDD', latest: { close: '5', volume: 10, changePct: '0' } },
  ];
  const best = new Map([[1, { strategyId: 'c-ai', total: 1200 }], [2, { strategyId: 'a-momentum', total: -300 }], [4, { strategyId: 'b-opus', total: 4500 }]]);
  const order = (key, dir = SORT_DEFAULT_DIR[key]) => sortInstruments(items, { key, dir }, { best }).map((i) => i.symbol);
  assert.equal(SORT_DEFAULT_DIR.best, 'desc');
  assert.deepEqual(order('best'), ['DDD', 'AAA', 'BBB', 'CCC']); // «Nenhuma ganha» (negativo) antes de sem cálculo
  assert.deepEqual(order('best', 'asc'), ['BBB', 'AAA', 'DDD', 'CCC']);
  assert.deepEqual(order('turnover'), ['BBB', 'AAA', 'DDD', 'CCC']); // 5000 €, 1000 €, 50 €
  assert.deepEqual(sortInstruments(items, { key: 'best', dir: 'desc' }).map((i) => i.symbol), ['AAA', 'BBB', 'CCC', 'DDD']); // ainda sem dados: por símbolo
});

test('cópias de segurança: tamanhos e aviso de cópia desactualizada', async () => {
  const { formatBytes, staleBackupWarning } = await import('../src/lib/backups.js');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(9_721_082).replace(/\s/g, ' '), '9,3 MB');
  assert.equal(formatBytes(1.5 * 1024 ** 3).replace(/\s/g, ' '), '1,5 GB');
  assert.equal(formatBytes(null), '—');
  const now = Date.parse('2026-11-12T12:00:00Z');
  assert.match(staleBackupWarning([], now), /Ainda não há/);
  assert.equal(staleBackupWarning([{ createdAt: '2026-11-12T03:30:00.000Z' }], now), null);
  assert.match(staleBackupWarning([{ createdAt: '2026-11-10T03:30:00.000Z' }], now), /56 horas/);
});

test('Vender Tudo: soma as posições do mesmo instrumento, ignora as sem correspondência, maiores primeiro; compras abertas a cancelar', async () => {
  const { openBuyOrders, sellAllPlan } = await import('../src/lib/saxo.js');
  const plan = sellAllPlan([
    { positionId: 1, instrumentId: 10, symbol: 'GALP.LS', quantity: 100, marketValue: 1900, currency: 'EUR' },
    { positionId: 2, instrumentId: 10, symbol: 'GALP.LS', quantity: 50, marketValue: 950, currency: 'EUR' },
    { positionId: 3, instrumentId: 11, symbol: 'BCP.LS', quantity: 5000, marketValue: 4000, currency: 'EUR' },
    { positionId: 4, instrumentId: null, symbol: 'XYZ:xnas', quantity: 3 },
    { positionId: 5, instrumentId: 12, symbol: 'VAZIA.LS', quantity: 0 },
  ]);
  assert.deepEqual(plan.orders.map((o) => [o.symbol, o.quantity]), [['BCP.LS', 5000], ['GALP.LS', 150]]);
  assert.deepEqual(plan.skipped, ['XYZ:xnas']);
  assert.deepEqual(sellAllPlan(undefined), { orders: [], skipped: [] });
  const open = openBuyOrders([{ id: 1, side: 'buy', status: 'working' }, { id: 2, side: 'sell', status: 'working' }, { id: 3, side: 'buy', status: 'filled' }]);
  assert.deepEqual(open.map((o) => o.id), [1]);
});

test('medir no gráfico: sessões, dias de calendário e variação %, nos dois sentidos', async () => {
  const { daysBetween, measureRange, measureText } = await import('../src/lib/chartMeasure.js');
  const data = [
    { date: '2026-10-30', value: 10 }, { date: '2026-11-02', value: 10.5 }, { date: '2026-11-03', value: 11 }, { date: '2026-11-04', value: 9 },
  ];
  assert.equal(daysBetween('2026-10-30', '2026-11-03'), 4);
  const up = measureRange(data, '2026-10-30', '2026-11-03');
  assert.deepEqual([up.sessions, up.days, up.pct, up.direction], [3, 4, 10, 'forward']);
  assert.equal(measureText(up).replace(/\s/g, ' '), '3 sessões · 4 dias · +10,00 %');
  const back = measureRange(data, '2026-11-04', '2026-10-30'); // arrastar para a esquerda: do fim para o início
  assert.deepEqual([back.sessions, back.days, Math.round(back.pct * 10) / 10, back.direction], [4, -5, 11.1, 'backward']);
  assert.equal(measureText(measureRange(data, '2026-11-03', '2026-11-04')).replace(/\s/g, ' '), '2 sessões · 1 dia · −18,18 %');
  assert.equal(measureText(measureRange(data, '2026-11-02', '2026-11-02')).replace(/\s/g, ' '), '1 sessão · 0 dias · +0,00 %');
  assert.equal(measureRange(data, '2026-11-02', 'x'), null);
  assert.equal(measureRange(data, null, '2026-11-02'), null);
});

test('RSI14 do gráfico: o mesmo RSI de Wilder da D-Reversão, sobre o fecho ajustado, e as zonas', async () => {
  const { rsiSeries, rsiZone, RSI_PERIOD } = await import('../src/lib/rsi.js');
  const { rsiWilder } = await import('../../shared/strategies/d-reversao.js');
  assert.equal(RSI_PERIOD, 14);
  const quotes = Array.from({ length: 40 }, (_, i) => ({ close: 50 + i * 3, adjClose: 10 + Math.sin(i / 3) * 4 + i * 0.2 }));
  const rsi = rsiSeries(quotes);
  assert.equal(rsi.length, 40);
  assert.ok(rsi.slice(0, 14).every((v) => v == null) && rsi[14] != null);
  assert.deepEqual(rsi, rsiWilder(quotes.map((q) => q.adjClose), 14)); // usa o fecho ajustado, não o fecho
  const up = rsiSeries(Array.from({ length: 30 }, (_, i) => ({ close: 10 + i })));
  assert.equal(up.at(-1), 100); // só subidas
  assert.equal(rsiZone(71), 'sobrecomprado');
  assert.equal(rsiZone(30), 'sobrevendido');
  assert.equal(rsiZone(50), null);
  assert.equal(rsiZone(null), null);
});

test('posições no gráfico: um marcador por posição aberta, na sessão da compra, na escala do fecho ajustado', async () => {
  const { openDate, positionMarkers } = await import('../src/lib/chartPositions.js');
  const data = [
    { date: '2026-11-02', value: 9, close: 10 }, { date: '2026-11-03', value: 9.9, close: 11 }, { date: '2026-11-04', value: 10.8, close: 12 },
  ];
  assert.equal(openDate('2026-11-03T09:30:00Z'), '2026-11-03');
  assert.equal(openDate(null), null);
  const m = positionMarkers(data, [
    { positionId: 'a', openedAt: '2026-11-03T09:30:00Z', openPrice: 11, quantity: 100 },
    { positionId: 'b', openedAt: '2026-11-01T09:30:00Z', openPrice: 10, quantity: 5 },   // antes do período: sem marcador
    { positionId: 'c', openedAt: null, openPrice: 10, quantity: 1 },                       // sem data: sem marcador
    { positionId: 'd', openedAt: '2026-11-04T08:00:00Z', openPrice: 12, quantity: 7 },
  ]);
  assert.deepEqual(m.map((x) => [x.date, Math.round(x.y * 100) / 100, x.quantity]), [['2026-11-03', 9.9, 100], ['2026-11-04', 10.8, 7]]);
  assert.deepEqual(positionMarkers([], [{ openedAt: '2026-11-03T00:00:00Z', openPrice: 1 }]), []);
  assert.equal(positionMarkers(data, undefined).length, 0);
  // Fim de semana: fica na sessão seguinte.
  const wk = [{ date: '2026-11-06', value: 5, close: 5 }, { date: '2026-11-09', value: 6, close: 6 }];
  assert.equal(positionMarkers(wk, [{ openedAt: '2026-11-07T10:00:00Z', openPrice: 5.5 }])[0].date, '2026-11-09');
});
