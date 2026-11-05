/** Página «Calor»: médias mensais do valor negociado (tabela acessível) e máximo da janela. */

/** [{ month: 'AAAA-MM', value, sma200, sessions }] com as médias de cada mês (sma200 só dos dias que a têm). */
export function monthlyAverages(points) {
  const by = new Map();
  for (const p of points) {
    const m = p.date.slice(0, 7);
    if (!by.has(m)) by.set(m, { month: m, sum: 0, n: 0, smaSum: 0, smaN: 0 });
    const g = by.get(m);
    g.sum += p.value;
    g.n += 1;
    if (p.sma200 != null) { g.smaSum += p.sma200; g.smaN += 1; }
  }
  return [...by.values()].map((g) => ({
    month: g.month, value: g.sum / g.n, sma200: g.smaN ? g.smaSum / g.smaN : null, sessions: g.n,
  }));
}

/** Sessão com o maior valor negociado (ou null). */
export function peakSession(points) {
  return points.reduce((best, p) => (best == null || p.value > best.value ? p : best), null);
}

const MONTHS = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
/** 'AAAA-MM' → «nov. 2026». */
export function monthLabel(month) {
  const [y, m] = month.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}
