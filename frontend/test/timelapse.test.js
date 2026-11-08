import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allFrameIds, biggestMoves, changeText, changeTone, deltaLabel, frameRows, toneLegend } from '../src/lib/timelapse.js';

const frames = [
  { date: 'd1', items: [{ id: 1, value: 30 }, { id: 2, value: 20 }, { id: 3, value: 10 }] },
  { date: 'd2', items: [{ id: 2, value: 40 }, { id: 1, value: 35 }, { id: 4, value: 12 }] },
];

test('timelapse: posições, variação, entradas e saídas', () => {
  const ids = allFrameIds(frames);
  assert.deepEqual(ids, [1, 2, 3, 4]);
  const r = Object.fromEntries(frameRows(frames, 1, ids).map((x) => [x.id, x]));
  assert.deepEqual(r[2], { id: 2, rank: 0, value: 40, change: null, delta: 1, isNew: false });
  assert.deepEqual(r[1], { id: 1, rank: 1, value: 35, change: null, delta: -1, isNew: false });
  assert.deepEqual(r[4], { id: 4, rank: 2, value: 12, change: null, delta: null, isNew: true });
  assert.deepEqual(r[3], { id: 3, rank: null, value: 0, change: null, delta: null, isNew: false }); // saiu do top
  assert.equal(frameRows(frames, 0, ids).find((x) => x.id === 1).isNew, false); // na primeira sessão ninguém é «novo»
  assert.deepEqual([r[2], r[1], r[4], { delta: 0 }].map((x) => deltaLabel({ isNew: false, ...x })), ['▲ 1', '▼ 1', 'novo', '=']);
  assert.deepEqual(biggestMoves(frames), { up: { id: 2, delta: 1 }, down: { id: 1, delta: -1 } });
  assert.deepEqual(biggestMoves([frames[0]]), { up: null, down: null });
});

test('timelapse: tom da barra pela variação do preço, com a faixa neutra ajustada às sessões somadas', () => {
  assert.equal(changeTone(0.015, 5), 'flat');      // 5 sessões: ±2 % é «quase não mexeu»
  assert.equal(changeTone(0.015, 1), 'up-1');      // numa só sessão, 1,5 % já é subida
  assert.equal(changeTone(-0.03, 5), 'down-1');
  assert.equal(changeTone(0.05, 5), 'up-2');
  assert.equal(changeTone(-0.09, 5), 'down-3');
  assert.equal(changeTone(0.02, 5), 'up-1');       // limite: a faixa neutra é aberta
  assert.equal(changeTone(null, 5), null);
  assert.deepEqual(toneLegend(5).map((x) => x.label), ['≤ −8 %', '−8 a −4 %', '−4 a −2 %', '±2 %', '+2 a +4 %', '+4 a +8 %', '≥ +8 %']);
  assert.equal(toneLegend(1)[3].label, '±1 %');
  assert.deepEqual([changeText(0.0213), changeText(-0.004), changeText(0), changeText(null), changeText(-0.0004)], ['+2,1 %', '−0,4 %', '0,0 %', '', '0,0 %']);
});
