import { describe, expect, it } from 'vitest';
import { turnoverSeries, turnoverSummary, yearsBeforeIso } from '../src/services/turnover.js';
import { marketCapByDate } from '../src/services/marketcap.js';
import { buildFrames } from '../src/services/timelapse.js';

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

describe('timelapse: top do valor negociado e variação do preço', () => {
  const dates = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  // A negoceia 100 por sessão a preço fixo; B só nas duas últimas sessões, 1000 cada, e o preço sobe de 10 para 12;
  // C negoceia 5 e falta na 11.ª sessão (feriado local: conta o fecho anterior).
  const rows = dates.flatMap((date, i) => [
    { id: 1, date, value: 100, price: 50 },
    { id: 2, date, value: i >= 10 ? '1000' : 0, price: i >= 11 ? 12 : 10 },
    ...(i === 10 ? [] : [{ id: 3, date, value: 5, price: 20 + i }]),
  ]);

  it('soma as sessões até cada data, ordena e calcula a variação do preço desde o fecho anterior à janela', () => {
    const f = buildFrames(dates, rows, { window: 10, sessions: 22, top: 3 });
    expect(f.map((x) => [x.from, x.date])).toEqual([['2026-10-02', '2026-10-11'], ['2026-10-03', '2026-10-12']]);
    expect(f[0].items).toEqual([{ id: 1, value: 1000, change: 0 }, { id: 2, value: 1000, change: 0 }, { id: 3, value: 45, change: 0.45 }]); // empate: o id mais baixo primeiro
    expect(f[1].items[0]).toEqual({ id: 2, value: 2000, change: 0.2 });
    expect(f[1].items[2].change).toBeCloseTo(31 / 21 - 1, 6); // C: de 21 (fecho de 2 out.) a 31
  });

  it('só o universo pedido, só os últimos `sessions` pontos, sem valores nulos e sem universo vazio', () => {
    const f = buildFrames(dates, rows, { only: new Set([1, 3]), window: 1, sessions: 2, top: 30 });
    expect(f.map((x) => x.date)).toEqual(['2026-10-11', '2026-10-12']);
    expect(f[0].items).toEqual([{ id: 1, value: 100, change: 0 }]); // C não negociou a 11
    expect(f[1].items.map((x) => x.id)).toEqual([1, 3]);
    expect(buildFrames(dates.slice(0, 5), rows, { window: 10 })).toEqual([]); // sem sessões suficientes
    expect(buildFrames([], [])).toEqual([]);
    expect(buildFrames(dates, rows, { only: new Set() })).toEqual([]);
  });
});
