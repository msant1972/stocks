/**
 * Valor negociado diário de todo o catálogo (página «Calor», no grupo Estratégias).
 *
 * Por instrumento e sessão: VN = volume × (abertura + mínimo + máximo + fecho) / 4, em preços reais (não ajustados).
 * Por sessão: soma de todos os instrumentos activos. A SMA200 é calculada sobre a série completa e só depois se
 * recorta a janela pedida, para os primeiros pontos da janela já terem média.
 */

export const TURNOVER_SQL = `
  SELECT q.session_date AS date,
         SUM(q.volume * (COALESCE(q.open, q.close) + COALESCE(q.high, q.close) + COALESCE(q.low, q.close) + q.close) / 4) AS value,
         SUM(q.volume > 0) AS instruments
    FROM daily_quotes q
    JOIN instruments i ON i.id = q.instrument_id
   WHERE i.status = 'active' AND q.session_date >= ?
   GROUP BY q.session_date
   ORDER BY q.session_date`;

/** Data AAAA-MM-DD `years` anos antes de `iso`. */
export function yearsBeforeIso(iso, years) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/**
 * Série da janela: [{ date, value, sma200, instruments }] (value e sma200 em euros, sma200 null sem 200 sessões).
 * rows: sessões por ordem cronológica, com o histórico anterior à janela para aquecer a média.
 */
export function turnoverSeries(rows, { years = 2, smaN = 200 } = {}) {
  if (rows.length === 0) return [];
  const values = rows.map((r) => Number(r.value) || 0);
  const out = [];
  let sum = 0;
  const from = yearsBeforeIso(rows.at(-1).date, years);
  for (let i = 0; i < rows.length; i += 1) {
    sum += values[i];
    if (i >= smaN) sum -= values[i - smaN];
    if (rows[i].date <= from) continue;
    out.push({
      date: rows[i].date, value: Math.round(values[i]),
      sma200: i >= smaN - 1 ? Math.round(sum / smaN) : null,
      instruments: Number(rows[i].instruments) || 0,
    });
  }
  return out;
}

/** Resumo do último dia: valor, SMA200 e a diferença entre os dois (fracção). */
export function turnoverSummary(series) {
  const last = series.at(-1);
  if (!last) return null;
  return {
    date: last.date, value: last.value, sma200: last.sma200,
    vsSma200: last.sma200 ? last.value / last.sma200 - 1 : null,
  };
}
