/** Datas 'AAAA-MM-DD' (módulo leve, usado também pelos workers das estratégias). */

/** 'AAAA-MM-DD' recuado n anos; 29 de Fevereiro passa a 28. */
export function yearsBefore(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y - n, m - 1, d));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
}
