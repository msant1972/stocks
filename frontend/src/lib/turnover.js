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

/** Quantil q (0 a 1) de uma lista ordenada, com interpolação linear. */
function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export const HEAT_LABELS = ['Frio', 'Morno', 'Quente', 'Muito quente'];

/**
 * Valor negociado total de cada mês: [{ month, value, sessions, perSession, partial, heat, rank }].
 * partial: o primeiro mês da janela (quando começa depois do dia 4, ou seja, sem as primeiras sessões) e o mês de
 * `today` (ainda a decorrer). heat: quartil (1 = mais frio, 4 = mais quente) entre os meses completos; null nos parciais.
 * rank: posição entre os meses completos, do mais quente (1) para o mais frio.
 */
export function monthlyTotals(points, { today } = {}) {
  const by = new Map();
  for (const p of points) {
    const m = p.date.slice(0, 7);
    if (!by.has(m)) by.set(m, { month: m, value: 0, sessions: 0, firstDay: Number(p.date.slice(8, 10)) });
    const g = by.get(m);
    g.value += p.value;
    g.sessions += 1;
  }
  const months = [...by.values()];
  const currentMonth = today ? today.slice(0, 7) : null;
  const rows = months.map((g, i) => ({
    month: g.month, value: g.value, sessions: g.sessions, perSession: g.value / g.sessions,
    partial: (i === 0 && g.firstDay > 4) || g.month === currentMonth,
    heat: null, rank: null,
  }));
  const full = rows.filter((r) => !r.partial);
  if (full.length > 0) {
    const sorted = full.map((r) => r.value).sort((a, b) => a - b);
    const [q1, q2, q3] = [0.25, 0.5, 0.75].map((q) => quantile(sorted, q));
    for (const r of full) r.heat = r.value > q3 ? 4 : r.value > q2 ? 3 : r.value > q1 ? 2 : 1;
    [...full].sort((a, b) => b.value - a.value).forEach((r, i) => { r.rank = i + 1; });
  }
  return rows;
}
