import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allFrameIds, biggestMoves, deltaLabel, frameRows } from '../src/lib/timelapse.js';

const frames = [
  { date: 'd1', items: [{ id: 1, value: 30 }, { id: 2, value: 20 }, { id: 3, value: 10 }] },
  { date: 'd2', items: [{ id: 2, value: 40 }, { id: 1, value: 35 }, { id: 4, value: 12 }] },
];

test('timelapse: posições, variação, entradas e saídas', () => {
  const ids = allFrameIds(frames);
  assert.deepEqual(ids, [1, 2, 3, 4]);
  const r = Object.fromEntries(frameRows(frames, 1, ids).map((x) => [x.id, x]));
  assert.deepEqual(r[2], { id: 2, rank: 0, value: 40, delta: 1, isNew: false });
  assert.deepEqual(r[1], { id: 1, rank: 1, value: 35, delta: -1, isNew: false });
  assert.deepEqual(r[4], { id: 4, rank: 2, value: 12, delta: null, isNew: true });
  assert.deepEqual(r[3], { id: 3, rank: null, value: 0, delta: null, isNew: false }); // saiu do top
  assert.equal(frameRows(frames, 0, ids).find((x) => x.id === 1).isNew, false); // na primeira sessão ninguém é «novo»
  assert.deepEqual([r[2], r[1], r[4], { delta: 0 }].map((x) => deltaLabel({ isNew: false, ...x })), ['▲ 1', '▼ 1', 'novo', '=']);
  assert.deepEqual(biggestMoves(frames), { up: { id: 2, delta: 1 }, down: { id: 1, delta: -1 } });
  assert.deepEqual(biggestMoves([frames[0]]), { up: null, down: null });
});
