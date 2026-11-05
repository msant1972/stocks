/**
 * Capitalização total do catálogo (página «Calor», gráfico «Capitalização Mercado»).
 *
 * Por instrumento e sessão: cap = fecho × número de acções. O número de acções é o actual (`sharesOutstanding` do
 * Yahoo, em company_profiles), aplicado a todo o histórico; o fecho do Yahoo já vem ajustado a desdobramentos, por
 * isso a série não salta num desdobramento. Emissões e recompras de acções não são reconstituídas.
 *
 * Por sessão: soma dos instrumentos activos com número de acções. Num feriado local (ex.: Xetra fechada a 24 de
 * dezembro) o instrumento sem sessão conta com a última capitalização conhecida, até MAX_CARRY_DAYS dias de calendário;
 * sem isso a soma cairia para metade nesses dias. A série e a SMA200 usam depois as funções do valor negociado.
 */

export const MAX_CARRY_DAYS = 10;

export const MARKET_CAP_SQL = `
  SELECT q.instrument_id AS id, q.session_date AS date, q.close * p.shares_outstanding AS cap
    FROM daily_quotes q
    JOIN instruments i ON i.id = q.instrument_id
    JOIN company_profiles p ON p.instrument_id = i.id
   WHERE i.status = 'active' AND p.shares_outstanding > 0 AND q.session_date >= ?
   ORDER BY q.session_date`;

export const MARKET_CAP_COVERAGE_SQL = `
  SELECT COUNT(*) AS total, COALESCE(SUM(p.shares_outstanding > 0), 0) AS withShares
    FROM instruments i
    LEFT JOIN company_profiles p ON p.instrument_id = i.id
   WHERE i.status = 'active'`;

const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/**
 * Soma por sessão: [{ date, value, instruments }] por ordem cronológica. rows: { id, date, cap } por ordem de data.
 * instruments: quantos tiveram sessão nesse dia (os que contam com o valor anterior não entram na contagem).
 */
export function marketCapByDate(rows) {
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  const last = new Map(); // id -> { cap, day }
  const out = [];
  for (const [date, list] of byDate) {
    const day = dayNumber(date);
    for (const r of list) last.set(r.id, { cap: Number(r.cap) || 0, day });
    let value = 0;
    for (const [id, l] of last) {
      if (day - l.day > MAX_CARRY_DAYS) last.delete(id);
      else value += l.cap;
    }
    out.push({ date, value, instruments: list.length });
  }
  return out;
}
