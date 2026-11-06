import { describe, expect, it } from 'vitest';
import { fromScaled, ratio, roundDiv, toScaled } from '../src/money.js';

describe('aritmética decimal', () => {
  it('converte e arredonda meio para longe de zero', () => {
    expect(toScaled('12.345', 2)).toBe(1235n);
    expect(toScaled('12.344', 2)).toBe(1234n);
    expect(toScaled('-12.345', 2)).toBe(-1235n);
    expect(toScaled('7', 2)).toBe(700n);
    expect(fromScaled(5n, 2)).toBe('0.05');
    expect(fromScaled(-5n, 2)).toBe('-0.05');
    expect(fromScaled(123456n, 2)).toBe('1234.56');
  });

  it('rejeita valores não decimais', () => {
    expect(() => toScaled('1e5', 2)).toThrow();
    expect(() => toScaled('abc', 2)).toThrow();
  });

  it('divide com arredondamento', () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
    expect(roundDiv(4n, 3n)).toBe(1n);
  });

  it('calcula rácios sem erros de vírgula flutuante', () => {
    expect(ratio(1n, 3n, 4)).toBe('0.3333');
  });
});
