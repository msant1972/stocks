/**
 * Timelapse (Mercado): o top 30 dos instrumentos pelo valor negociado das últimas 10 sessões, sessão a sessão, nas últimas
 * 22 sessões. Valor negociado de uma sessão = volume × (abertura + mínimo + máximo + fecho) / 4, como na página Calor.
 * As sessões são as do calendário comum do catálogo: um feriado local conta como sessão sem negócios desse instrumento.
 */

export const WINDOWS = [1, 5, 10];
export const WINDOW = 5;    // sessões somadas em cada ponto, por omissão (também 1 ou 10)
const MAX_WINDOW = Math.max(...WINDOWS);
export const SESSIONS = 22; // pontos da animação
export const TOP = 30;

/** Datas de sessão mais recentes do catálogo (as necessárias para 22 pontos de 10 sessões, mais uma de referência do preço). */
export const DATES_SQL = `
  SELECT DISTINCT q.session_date AS date
    FROM daily_quotes q JOIN instruments i ON i.id = q.instrument_id
   WHERE i.status = 'active' AND q.session_date >= ?
   ORDER BY q.session_date DESC
   LIMIT ?`;

export const VALUES_SQL = `
  SELECT q.instrument_id AS id, q.session_date AS date,
         q.volume * (COALESCE(q.open, q.close) + COALESCE(q.high, q.close) + COALESCE(q.low, q.close) + q.close) / 4 AS value,
         COALESCE(q.adj_close, q.close) AS price
    FROM daily_quotes q JOIN instruments i ON i.id = q.instrument_id
   WHERE i.status = 'active' AND q.session_date >= ?`;

/** Sessões a pedir: as 22 da animação, as 9 anteriores para a soma de 10 e mais uma para a variação do preço. */
export const DATES_NEEDED = 22 + MAX_WINDOW;

/**
 * Pontos da animação. dates: sessões por ordem cronológica; rows: { id, date, value, price } de cada instrumento e sessão.
 * only: conjunto de ids do universo (null = todos). Devolve [{ date, from, items: [{ id, value, change }] }], do mais antigo
 * para o mais recente, com no máximo `sessions` pontos; cada ponto tem os `top` maiores valores das `window` sessões até
 * `date`. change: variação do preço (fecho ajustado) nessas sessões, do fecho anterior a `from` ao fecho de `date` (um
 * feriado local usa o último fecho conhecido; null sem fecho de referência).
 */
export function buildFrames(dates, rows, { only = null, window = WINDOW, sessions = SESSIONS, top = TOP } = {}) {
  const index = new Map(dates.map((d, i) => [d, i]));
  const byId = new Map();
  for (const r of rows) {
    const id = Number(r.id);
    if (only && !only.has(id)) continue;
    const i = index.get(r.date);
    if (i == null) continue;
    if (!byId.has(id)) byId.set(id, { value: new Float64Array(dates.length), price: new Array(dates.length).fill(null) });
    const e = byId.get(id);
    e.value[i] += Number(r.value) || 0;
    if (Number(r.price) > 0) e.price[i] = Number(r.price);
  }
  // Último fecho conhecido em cada sessão (um feriado local repete o anterior).
  for (const e of byId.values()) for (let i = 1; i < dates.length; i++) if (e.price[i] == null) e.price[i] = e.price[i - 1];
  if (byId.size === 0) return []; // universo vazio (ex.: conta SAXO sem posições): nada para animar
  const frames = [];
  // Cada ponto precisa das `window` sessões e do fecho da sessão anterior (referência da variação do preço).
  for (let end = Math.max(window, dates.length - sessions); end < dates.length; end++) {
    const items = [];
    for (const [id, e] of byId) {
      let sum = 0;
      for (let k = end - window + 1; k <= end; k++) sum += e.value[k];
      const ref = e.price[end - window];
      const change = ref && e.price[end] ? Math.round((e.price[end] / ref - 1) * 1e6) / 1e6 : null;
      if (sum > 0) items.push({ id, value: Math.round(sum), change });
    }
    items.sort((a, b) => b.value - a.value || a.id - b.id);
    frames.push({ date: dates[end], from: dates[end - window + 1], items: items.slice(0, top) });
  }
  return frames;
}
