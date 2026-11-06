import { describe, expect, it } from 'vitest';
import {
  analystTargets, annualEps, cheapness, currentMetrics, dcfValue, forwardEpsYear, graham, liveProfile, overallVerdict, peHistory, reverseDcf, revenueGrowth,
  sectorComparison, valuation,
} from '../src/valuation.js';

// Galp (Yahoo, 4 nov. 2026), com o preço de referência da recolha.
const GALP = {
  sector: 'Energy', currency: 'EUR', financial_currency: 'EUR', ref_price: '19.85', market_cap: '14347606016',
  trailing_pe: '14.078', price_to_book: '3.0637', enterprise_value: '17779253248', enterprise_to_ebitda: '4.468',
  dividend_yield: '3.4', free_cashflow: '2440875008', eps: '1.41', book_value: '6.479',
  target_mean: '23.51', target_median: '23.3', target_low: '18.4', target_high: '28', analyst_count: 18, recommendation_key: 'buy',
};

describe('rácios ao fecho do dia', () => {
  it('reescala os rácios do Yahoo pelo fecho / preço de referência', () => {
    const same = currentMetrics(GALP, '19.85');
    expect(same.pe).toBeCloseTo(14.078);
    expect(same.evEbitda).toBeCloseTo(4.468);
    expect(same.fcfYield).toBeCloseTo((2440875008 / 14347606016) * 100);
    const up = currentMetrics(GALP, '21.835'); // +10 %
    expect(up.pe).toBeCloseTo(14.078 * 1.1);
    expect(up.pb).toBeCloseTo(3.0637 * 1.1);
    expect(up.dividendYield).toBeCloseTo(3.4 / 1.1);
    // O valor da empresa sobe com a capitalização; a dívida líquida mantém-se.
    expect(up.evEbitda).toBeCloseTo(4.468 * ((17779253248 + 14347606016 * 0.1) / 17779253248));
  });

  it('bancos sem EV/EBITDA nem fluxo de caixa livre; prejuízo sem P/E; contas noutra moeda sem rendimento do FCF', () => {
    const bank = currentMetrics({ ...GALP, sector: 'Financial Services' }, '19.85');
    expect(bank.evEbitda).toBeNull();
    expect(bank.fcfYield).toBeNull();
    expect(currentMetrics({ ...GALP, trailing_pe: '-3' }, '19.85').pe).toBeNull();
    expect(currentMetrics({ ...GALP, financial_currency: 'USD' }, '19.85').fcfYield).toBeNull();
    // Sem preço de referência (perfis antigos), usa os rácios tal como vieram.
    expect(currentMetrics({ ...GALP, ref_price: null }, '30').pe).toBeCloseTo(14.078);
  });
});

describe('comparação com o sector', () => {
  it('percentil de barateza com empates a meio', () => {
    expect(cheapness(10, [5, 10, 15, 20], 'low')).toBeCloseTo((2 + 0.5) / 4);
    expect(cheapness(3, [1, 2, 4], 'high')).toBeCloseTo(2 / 3);
    expect(cheapness(null, [1], 'low')).toBeNull();
  });

  it('precisa de pelo menos 5 pares por indicador e dá o veredicto pela média', () => {
    const peers = [20, 22, 25, 30, 35, 40].map((pe) => ({ row: { ...GALP, trailing_pe: String(pe), dividend_yield: '1' }, close: '19.85' }));
    const r = sectorComparison(GALP, '19.85', peers);
    const pe = r.metrics.find((m) => m.key === 'pe');
    expect(pe).toMatchObject({ peers: 6, cheapness: 1, sectorMedian: 27.5 });
    expect(r.metrics.find((m) => m.key === 'dividendYield').cheapness).toBe(1);
    expect(r.verdict).toBe('cheap');
    expect(sectorComparison(GALP, '19.85', peers.slice(0, 4))).toMatchObject({ metrics: [], score: null, verdict: null });
  });
});

describe('P/E face à própria história', () => {
  const days = (from, count, close) => {
    const out = [];
    const d = new Date(`${from}T00:00:00Z`);
    for (let i = 0; i < count; i++) {
      out.push({ date: d.toISOString().slice(0, 10), close: String(typeof close === 'function' ? close(i) : close) });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  };

  it('usa o último resultado anual conhecido (a partir de Abril do ano seguinte)', () => {
    const fin = [{ year: 2023, dilutedEps: 2 }, { year: 2024, dilutedEps: 4 }];
    // Antes de 1 abr. 2024 não há resultado conhecido; até 1 abr. 2025 vale o de 2023; depois o de 2024.
    const closes = [...days('2024-03-01', 31, 20), ...days('2024-04-01', 365, 20), ...days('2025-04-01', 100, 40)];
    const r = peHistory(GALP, fin, closes);
    expect(r.points).toBe(465);
    expect(r.series.at(-1)).toMatchObject({ pe: 10 });
    expect(r.from).toBe('2024-04-01');
    expect(r.median).toBe(10);
    expect(r.verdict).toBe('fair');
    expect(r.eps).toBeGreaterThan(0);
    expect(r.epsYear).toBe(fin.at(-1).year);
  });

  it('barato abaixo do 1.º quartil, caro acima do 3.º; sem dados suficientes não decide', () => {
    const fin = [{ year: 2022, dilutedEps: 1 }];
    const rising = days('2023-04-01', 400, (i) => 10 + i / 10);
    expect(peHistory(GALP, fin, rising).verdict).toBe('expensive');
    const falling = days('2023-04-01', 400, (i) => 50 - i / 10);
    expect(peHistory(GALP, fin, falling).verdict).toBe('cheap');
    expect(peHistory(GALP, fin, rising.slice(0, 100))).toMatchObject({ verdict: null, reason: 'short' });
    expect(peHistory({ ...GALP, financial_currency: 'USD' }, fin, rising)).toMatchObject({ verdict: null, reason: 'currency' });
    expect(peHistory(GALP, [{ year: 2022, dilutedEps: -1 }], rising).points).toBe(0);
  });
});

describe('cabeçalho do painel Empresa ao último preço', () => {
  // Rheinmetall: perfil de 4 nov. 2026 (a 1003,40 €) visto com o preço de 6 nov. (810,20 €).
  const RHM = {
    ref_price: '1003.4', market_cap: '46826737664', trailing_pe: '38.967', forward_pe: '18.9647', price_to_book: '9.4175',
    dividend_yield: '1.15', eps: '25.75', forward_eps: '52.9089', low_52w: '909', high_52w: '1966', fetched_at: new Date('2026-11-04T20:52:49Z'),
  };
  const fin = [{ year: 2024 }, { year: 2025 }];

  it('escala capitalização, P/E, P/VC e dividendo; os resultados por acção não mudam', () => {
    const l = liveProfile(RHM, '810.2', '2026-11-06', fin);
    expect(l).toMatchObject({ repriced: true, price: 810.2, priceDate: '2026-11-06', forwardYear: 2027 });
    expect(l.marketCap / 1e9).toBeCloseTo(37.81, 2);
    expect(l.trailingPe).toBeCloseTo(31.46, 2);
    expect(l.forwardPe).toBeCloseTo(15.31, 2);
    expect(l.priceToBook).toBeCloseTo(7.6, 2);
    expect(l.dividendYield).toBeCloseTo(1.42, 2);
    expect(l.trailingEps).toBeCloseTo(25.75, 2);
    expect(l.forwardEps).toBeCloseTo(52.91, 2);
  });

  it('o intervalo de 52 semanas alarga-se com os extremos desde a recolha e com o último preço', () => {
    expect(liveProfile(RHM, '810.2', '2026-11-06', fin, { low: '798', high: '1010' })).toMatchObject({ low52w: 798, high52w: 1966 });
    expect(liveProfile(RHM, '810.2', '2026-11-06', fin)).toMatchObject({ low52w: 810.2, high52w: 1966 });
    expect(liveProfile(RHM, '2000', '2026-11-06', fin)).toMatchObject({ low52w: 909, high52w: 2000 });
    expect(liveProfile({ ...RHM, low_52w: null, high_52w: null }, '810.2', '2026-11-06', fin)).toMatchObject({ low52w: null, high52w: null });
  });

  it('sem preço de referência ou sem fecho ficam os valores da recolha', () => {
    expect(liveProfile({ ...RHM, ref_price: null }, '810.2', '2026-11-06', fin)).toMatchObject({ repriced: false, trailingPe: 38.967, marketCap: 46826737664, trailingEps: 25.75, forwardEps: 52.9089 });
    expect(liveProfile(RHM, null, null, fin)).toMatchObject({ repriced: false, trailingPe: 38.967, dividendYield: 1.15 });
  });

  it('ano fiscal do P/E estimado', () => {
    expect(forwardEpsYear([{ year: 2025 }], '2026-11-04')).toBe(2027);
    expect(forwardEpsYear([{ year: 2025 }], '2027-02-15')).toBe(2027); // contas de 2026 ainda por publicar
    expect(forwardEpsYear([{ year: 2026 }], '2027-04-10')).toBe(2028);
    expect(forwardEpsYear([{ year: 2026 }], '2026-11-04')).toBe(2028); // ano fiscal até Março (Ryanair)
    expect(forwardEpsYear([{ year: 2024 }], '2026-11-04')).toBe(2027); // contas em atraso
    expect(forwardEpsYear([], null)).toBeNull();
  });
});

describe('resultado por acção anual', () => {
  it('usa o diluído, salvo quando é incoerente com o resultado líquido / acções', () => {
    expect(annualEps({ dilutedEps: 2.89, netIncome: 7074e6, shares: 3025e6 })).toBe(2.89);
    expect(annualEps({ dilutedEps: 92.12, netIncome: 2.13e9, shares: 1e9 })).toBeCloseTo(2.13);
    expect(annualEps({ dilutedEps: null, netIncome: 2e9, shares: 1e9 })).toBe(2);
    expect(annualEps({ dilutedEps: -1, netIncome: 2e9, shares: 1e9 })).toBe(-1);
    expect(annualEps({ netIncome: 2e9 })).toBeNull();
  });
});

describe('analistas, Graham e DCF invertido', () => {
  it('preço-alvo: barato com ≥ 15 % de margem, caro acima do alvo, sem decisão com menos de 3 analistas', () => {
    expect(analystTargets(GALP, '19.85')).toMatchObject({ verdict: 'cheap', count: 18, recommendation: 'buy' });
    expect(analystTargets(GALP, '19.85').upside).toBeCloseTo(23.51 / 19.85 - 1);
    expect(analystTargets(GALP, '22').verdict).toBe('fair');
    expect(analystTargets(GALP, '24').verdict).toBe('expensive');
    expect(analystTargets({ ...GALP, analyst_count: 2 }, '10').verdict).toBeNull();
  });

  it('número de Graham com o resultado e o valor contabilístico derivados dos rácios', () => {
    const g = graham(GALP, '19.85');
    expect(g.eps).toBeCloseTo(19.85 / 14.078);
    expect(g.value).toBeCloseTo(Math.sqrt(22.5 * (19.85 / 14.078) * (19.85 / 3.0637)));
    expect(g.verdict).toBe('expensive'); // ≈ 14,3 €
    expect(graham({ ...GALP, trailing_pe: null }, '19.85').verdict).toBeNull();
    expect(graham({ ...GALP, ref_price: null }, '10').value).toBeCloseTo(Math.sqrt(22.5 * 1.41 * 6.479));
  });

  it('DCF invertido encontra o crescimento que iguala a capitalização', () => {
    const opts = { discount: 0.09, terminal: 0.02, years: 10 };
    const r = reverseDcf(GALP, '19.85', [{ year: 2022, revenue: 100 }, { year: 2025, revenue: 133.1 }]);
    expect(dcfValue(2440875008, r.impliedGrowth, opts)).toBeCloseTo(14347606016, -3);
    expect(r.revenueCagr).toBeCloseTo(0.1);
    expect(reverseDcf({ ...GALP, sector: 'Financial Services' }, '19.85', []).impliedGrowth).toBeNull();
    expect(reverseDcf({ ...GALP, free_cashflow: '-5' }, '19.85', []).impliedGrowth).toBeNull();
    expect(reverseDcf({ ...GALP, market_cap: '1' }, '19.85', [])).toMatchObject({ impliedGrowth: -0.5, bound: 'below' });
    expect(revenueGrowth([{ year: 2025, revenue: 5 }])).toBeNull();
  });
});

describe('veredicto global', () => {
  it('maioria dos critérios com dados, pelo menos 2', () => {
    expect(overallVerdict(['cheap', 'cheap', 'fair', null])).toMatchObject({ verdict: 'cheap', cheap: 2, total: 3 });
    expect(overallVerdict(['cheap', 'expensive', 'fair', 'fair'])).toMatchObject({ verdict: 'fair' });
    expect(overallVerdict(['expensive', 'expensive', 'cheap', 'fair'])).toMatchObject({ verdict: 'expensive' });
    expect(overallVerdict(['cheap', null, null, null])).toMatchObject({ verdict: 'insufficient', total: 1 });
  });

  it('junta tudo', () => {
    const v = valuation({ row: GALP, close: '19.85', closeDate: '2026-11-04', financials: [], closes: [], peers: [] });
    expect(v).toMatchObject({ price: 19.85, priceDate: '2026-11-04', currency: 'EUR' });
    expect(v.summary).toMatchObject({ verdict: 'fair', cheap: 1, expensive: 1, total: 2 }); // analistas barato, Graham caro
  });
});
