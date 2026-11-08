/**
 * Timelapse (Mercado): o top 30 dos instrumentos pelo valor negociado das últimas 10 sessões, sessão a sessão, nas últimas
 * 22 sessões. Valor negociado de uma sessão = volume × (abertura + mínimo + máximo + fecho) / 4, como na página Calor.
 * As sessões são as do calendário comum do catálogo: um feriado local conta como sessão sem negócios desse instrumento.
 */

export const WINDOW = 10;   // sessões somadas em cada ponto
export const SESSIONS = 22; // pontos da animação
export const TOP = 30;

/** Datas de sessão mais recentes do catálogo, por ordem (as necessárias para 22 pontos de 10 sessões). */
export const DATES_SQL = `
  SELECT DISTINCT q.session_date AS date
    FROM daily_quotes q JOIN instruments i ON i.id = q.instrument_id
   WHERE i.status = 'active' AND q.session_date >= ?
   ORDER BY q.session_date DESC
   LIMIT ?`;

export const VALUES_SQL = `
  SELECT q.instrument_id AS id, q.session_date AS date,
         q.volume * (COALESCE(q.open, q.close) + COALESCE(q.high, q.close) + COALESCE(q.low, q.close) + q.close) / 4 AS value
    FROM daily_quotes q JOIN instruments i ON i.id = q.instrument_id
   WHERE i.status = 'active' AND q.session_date >= ? AND q.volume > 0`;

/**
 * Pontos da animação. dates: sessões por ordem cronológica; rows: { id, date, value } de cada instrumento e sessão.
 * only: conjunto de ids do universo (null = todos). Devolve [{ date, from, items: [{ id, value }] }], do mais antigo para
 * o mais recente, com no máximo `sessions` pontos; cada ponto tem os `top` maiores valores das `window` sessões até `date`.
 */
export function buildFrames(dates, rows, { only = null, window = WINDOW, sessions = SESSIONS, top = TOP } = {}) {
  const index = new Map(dates.map((d, i) => [d, i]));
  const byId = new Map();
  for (const r of rows) {
    const id = Number(r.id);
    if (only && !only.has(id)) continue;
    const i = index.get(r.date);
    if (i == null) continue;
    if (!byId.has(id)) byId.set(id, new Float64Array(dates.length));
    byId.get(id)[i] += Number(r.value) || 0;
  }
  if (byId.size === 0) return []; // universo vazio (ex.: conta SAXO sem posições): nada para animar
  const frames = [];
  for (let end = Math.max(window - 1, dates.length - sessions); end < dates.length; end++) {
    if (end < window - 1) continue;
    const items = [];
    for (const [id, v] of byId) {
      let sum = 0;
      for (let k = end - window + 1; k <= end; k++) sum += v[k];
      if (sum > 0) items.push({ id, value: Math.round(sum) });
    }
    items.sort((a, b) => b.value - a.value || a.id - b.id);
    frames.push({ date: dates[end], from: dates[end - window + 1], items: items.slice(0, top) });
  }
  return frames;
}
