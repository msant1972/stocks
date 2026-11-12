/**
 * Medição no gráfico (Charts): carregar e arrastar marca uma área; mede a diferença de tempo e de preço entre a sessão onde
 * se carregou e a sessão onde está o rato. Só serve para medir: ao largar, a área desaparece.
 */

/** Dias de calendário entre duas datas AAAA-MM-DD (b − a; negativo se b for anterior). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Medida entre as sessões `from` (onde se carregou) e `to` (onde está o rato), sobre as séries do gráfico (`value`: fecho
 * ajustado). Devolve { from, to, sessions, days, change, pct, direction } ou null sem as duas sessões. `sessions` conta as
 * sessões da área (inclusive nas duas pontas); `days` e `pct` são com sinal: positivo se o rato está à direita e o preço subiu.
 */
export function measureRange(data, from, to) {
  if (!from || !to) return null;
  const i = data.findIndex((d) => d.date === from);
  const j = data.findIndex((d) => d.date === to);
  if (i < 0 || j < 0) return null;
  const a = data[i];
  const b = data[j];
  const change = b.value - a.value;
  return {
    from: a.date, to: b.date, sessions: Math.abs(j - i) + 1, days: daysBetween(a.date, b.date),
    change, pct: a.value ? (change / a.value) * 100 : null, direction: j >= i ? 'forward' : 'backward',
  };
}

/** Texto da medida: «21 sessões · 29 dias · +8,52 %». */
export function measureText(m) {
  if (!m) return '';
  const days = Math.abs(m.days);
  const pct = m.pct == null ? '—' : `${m.pct >= 0 ? '+' : '−'}${Math.abs(m.pct).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  return `${m.sessions} ${m.sessions === 1 ? 'sessão' : 'sessões'} · ${days} ${days === 1 ? 'dia' : 'dias'} · ${pct}`;
}
