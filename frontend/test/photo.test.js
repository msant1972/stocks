import test from 'node:test';
import assert from 'node:assert/strict';
import { initials, photoUrl, squareCrop } from '../src/lib/photo.js';

test('iniciais: primeiro e último nome', () => {
  assert.equal(initials('Miguel Santiago'), 'MS');
  assert.equal(initials('Ana Maria Costa'), 'AC');
  assert.equal(initials('ana'), 'A');
  assert.equal(initials('  '), '?');
  assert.equal(initials(null), '?');
});

test('endereço da fotografia só com versão', () => {
  assert.equal(photoUrl({ id: 3, photoVersion: null }), null);
  assert.equal(photoUrl({ id: 3 }), null);
  assert.equal(photoUrl({ id: 3, photoVersion: 99 }), '/api/v1/users/3/photo?v=99');
});

test('recorte quadrado ao centro', () => {
  assert.deepEqual(squareCrop(400, 300), { sx: 50, sy: 0, side: 300 });
  assert.deepEqual(squareCrop(300, 500), { sx: 0, sy: 100, side: 300 });
  assert.deepEqual(squareCrop(200, 200), { sx: 0, sy: 0, side: 200 });
});
