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

describe('timelapse: top do valor negociado de 10 sessões', () => {
  const dates = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  // A negoceia 100 por sessão; B 0 até à 9.ª e depois 1000; C só no universo «outro».
  const rows = dates.flatMap((date, i) => [{ id: 1, date, value: 100 }, ...(i >= 9 ? [{ id: 2, date, value: '1000' }] : []), { id: 3, date, value: 5 }]);

  it('soma as 10 sessões até cada data e ordena; B passa à frente quando ganha peso', () => {
    const f = buildFrames(dates, rows, { window: 10, sessions: 22, top: 2 });
    expect(f.map((x) => [x.from, x.date])).toEqual([['2026-10-01', '2026-10-10'], ['2026-10-02', '2026-10-11'], ['2026-10-03', '2026-10-12']]);
    expect(f[0].items).toEqual([{ id: 1, value: 1000 }, { id: 2, value: 1000 }]); // empate: o id mais baixo primeiro
    expect(f[2].items).toEqual([{ id: 2, value: 3000 }, { id: 1, value: 1000 }]);
  });

  it('só o universo pedido, só os últimos `sessions` pontos e sem valores nulos', () => {
    const f = buildFrames(dates, rows, { only: new Set([1, 3]), window: 10, sessions: 2, top: 30 });
    expect(f.map((x) => x.date)).toEqual(['2026-10-11', '2026-10-12']);
    expect(f[1].items).toEqual([{ id: 1, value: 1000 }, { id: 3, value: 50 }]);
    expect(buildFrames(dates.slice(0, 5), rows)).toEqual([]); // menos de 10 sessões: nenhum ponto
    expect(buildFrames([], [])).toEqual([]);
    expect(buildFrames(dates, rows, { only: new Set() })).toEqual([]); // universo vazio: sem sessões vazias
  });
});
