import { describe, expect, it } from 'vitest';
import { turnoverSeries, turnoverSummary, yearsBeforeIso } from '../src/services/turnover.js';
import { marketCapByDate } from '../src/services/marketcap.js';

const days = (n, start = '2023-01-02') => {
  const out = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};

describe('valor negociado (Calor)', () => {
  it('SMA200 sobre a série completa e janela dos últimos 2 anos', () => {
    const dates = days(1000);
    const rows = dates.map((date, i) => ({ date, value: String(i + 1), instruments: 3 }));
    const s = turnoverSeries(rows, { years: 2, smaN: 200 });
    // última data 2025-09-27 → a janela começa no dia 1 do mês de há 2 anos, para o mês ficar completo
    expect(dates.at(-1)).toBe('2025-09-27');
    expect(s[0].date).toBe('2023-09-01');
    expect(s.at(-1)).toEqual({ date: dates.at(-1), value: 1000, sma200: Math.round((801 + 1000) / 2), instruments: 3 });
    expect(s.every((p) => p.sma200 != null)).toBe(true); // havia mais de 200 sessões antes da janela
  });

  it('sem 200 sessões a média fica vazia; resumo face à média', () => {
    const rows = days(250).map((date, i) => ({ date, value: i < 200 ? 100 : 150, instruments: 1 }));
    const s = turnoverSeries(rows, { years: 2 });
    expect(s[198].sma200).toBeNull();
    expect(s[199].sma200).toBe(100);
    expect(turnoverSummary(s)).toMatchObject({ value: 150, sma200: 113 }); // (150 × 100 + 50 × 150) / 200 = 112,5
    expect(turnoverSummary(s).vsSma200).toBeCloseTo(150 / 113 - 1);
    expect(turnoverSummary([])).toBeNull();
    expect(turnoverSeries([])).toEqual([]);
  });

  it('anos antes de uma data', () => {
    expect(yearsBeforeIso('2026-11-05', 2)).toBe('2024-11-05');
  });
});

describe('capitalização (Calor)', () => {
  it('soma por sessão; num feriado local conta a última capitalização do instrumento, até 10 dias', () => {
    const rows = [
      { id: 1, date: '2024-12-23', cap: '100' }, { id: 2, date: '2024-12-23', cap: '50' },
      { id: 1, date: '2024-12-24', cap: '110' }, // o 2 não negociou (feriado): conta 50
      { id: 1, date: '2025-01-10', cap: '120' }, // o 2 está há 18 dias sem sessão: sai da soma
    ];
    expect(marketCapByDate(rows)).toEqual([
      { date: '2024-12-23', value: 150, instruments: 2 },
      { date: '2024-12-24', value: 160, instruments: 1 },
      { date: '2025-01-10', value: 120, instruments: 1 },
    ]);
    expect(marketCapByDate([])).toEqual([]);
  });
});
