import test from 'node:test';
import assert from 'node:assert/strict';
import { domainOf, fitSquare, internalLogoUrl, logosEnabled, logoUrl } from '../src/lib/logo.js';

test('domínio a partir do site', () => {
  assert.equal(domainOf('https://www.asml.com'), 'asml.com');
  assert.equal(domainOf('https://totalenergies.com/en/'), 'totalenergies.com');
  assert.equal(domainOf('http://WWW2.Siemens.COM/path?x=1'), 'siemens.com');
  assert.equal(domainOf('galp.com'), 'galp.com');
  assert.equal(domainOf('https://group.bnpparibas'), 'group.bnpparibas');
  assert.equal(domainOf(''), null);
  assert.equal(domainOf(null), null);
  assert.equal(domainOf('https://localhost'), null);
  assert.equal(domainOf('javascript:alert(1)'), null);
});

test('endereço do ícone: domínio, tamanho duplo e 404 sem logotipo', () => {
  assert.equal(logoUrl('asml.com', 'abc123XYZ', 48),
    'https://cdn.brandfetch.io/domain/asml.com/w/96/h/96/fallback/404/type/icon?c=abc123XYZ');
  assert.equal(logoUrl('asml.com', null), null);
  assert.equal(logoUrl(null, 'abc123XYZ'), null);
  assert.match(logoUrl('a.com', 'k', 4), /\/w\/16\/h\/16\//);
});

test('interruptor global ligado por omissão', () => {
  assert.equal(logosEnabled({ enabled: true }), true);
  assert.equal(logosEnabled({ enabled: false }), false);
  assert.equal(logosEnabled(undefined), true);
});

test('endereço do logotipo interno só com versão', () => {
  assert.equal(internalLogoUrl(7, 123), '/api/v1/instruments/7/logo?v=123');
  assert.equal(internalLogoUrl(7, null), null);
});

test('encaixar no quadrado de 128 px sem deformar', () => {
  assert.deepEqual(fitSquare(256, 128), { dx: 0, dy: 32, dw: 128, dh: 64 });
  assert.deepEqual(fitSquare(50, 100), { dx: 32, dy: 0, dw: 64, dh: 128 });
  assert.deepEqual(fitSquare(400, 400), { dx: 0, dy: 0, dw: 128, dh: 128 });
});
