import { describe, expect, it } from 'vitest';
import { amountCents, fromCents, fromScaled, ratio, roundDiv, toScaled } from '../src/money.js';
import { computeTrade } from '../src/services/trading.js';

describe('aritmética decimal', () => {
  it('converte e arredonda meio para longe de zero', () => {
    expect(toScaled('12.345', 2)).toBe(1235n);
    expect(toScaled('12.344', 2)).toBe(1234n);
    expect(toScaled('-12.345', 2)).toBe(-1235n);
    expect(toScaled('7', 2)).toBe(700n);
    expect(fromScaled(5n, 2)).toBe('0.05');
    expect(fromScaled(-5n, 2)).toBe('-0.05');
    expect(fromCents(123456n)).toBe('1234.56');
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

  it('calcula montantes sem erros de vírgula flutuante', () => {
    expect(fromCents(amountCents(3, '0.1'))).toBe('0.30');
    expect(fromCents(amountCents(7, '33.335'))).toBe('233.35'); // 233.345 -> 233.35
    expect(fromCents(amountCents(1000000, '0.000005'))).toBe('5.00');
    expect(ratio(1n, 3n, 4)).toBe('0.3333');
  });
});

describe('cálculo de operações (custo médio ponderado)', () => {
  const empty = { quantity: 0, cost_basis: '0.00', realized_pnl: '0.00' };

  it('compra dentro e fora do saldo', () => {
    const ok = computeTrade({ side: 'buy', quantity: 10, price: '25.50', cash: '1000.00', position: empty });
    expect(ok.error).toBeNull();
    expect(fromCents(ok.amount)).toBe('255.00');
    expect(fromCents(ok.cashAfter)).toBe('745.00');
    const ko = computeTrade({ side: 'buy', quantity: 40, price: '25.50', cash: '1000.00', position: empty });
    expect(ko.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('venda parcial retira custo proporcional e calcula o resultado realizado', () => {
    // 3 unidades com custo total 100.00 (custo médio 33.333...); vende 1 a 40.00.
    const pos = { quantity: 3, cost_basis: '100.00', realized_pnl: '0.00' };
    const r = computeTrade({ side: 'sell', quantity: 1, price: '40', cash: '0.00', position: pos });
    expect(fromCents(r.costAfter)).toBe('66.67');
    expect(fromCents(r.realized)).toBe('6.67');
    // A última unidade leva o custo restante: o custo total chega exactamente a zero.
    const last = computeTrade({ side: 'sell', quantity: 2, price: '40', cash: '0.00', position: { ...pos, quantity: 2, cost_basis: '66.67' } });
    expect(fromCents(last.costAfter)).toBe('0.00');
    expect(fromCents(last.realized)).toBe('13.33');
  });

  it('não permite vender mais do que detém', () => {
    const r = computeTrade({ side: 'sell', quantity: 4, price: '1', cash: '0', position: { quantity: 3, cost_basis: '3.00', realized_pnl: '0' } });
    expect(r.error.code).toBe('INSUFFICIENT_QUANTITY');
  });
});
