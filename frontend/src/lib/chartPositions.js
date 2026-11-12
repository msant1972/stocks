/**
 * Posições abertas da carteira SAXO no gráfico (Charts): um X verde na sessão em que cada posição foi comprada, ao preço de
 * abertura. Quando a posição é vendida deixa de vir da carteira, por isso o X desaparece. Funções puras (node --test).
 */

/** Data AAAA-MM-DD (UTC) de um instante ISO da SAXO, ou null. */
export const openDate = (openedAt) => (typeof openedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(openedAt) ? openedAt.slice(0, 10) : null);

/**
 * Marcadores do gráfico: positions = posições abertas do instrumento ({ openedAt, openPrice, quantity }); data = séries do gráfico
 * ({ date, value (fecho ajustado), close (fecho) }). A compra fora do período mostrado não tem marcador; num dia sem sessão
 * (ex.: fim de semana) fica na sessão seguinte. O preço converte-se para a escala do gráfico (fecho ajustado ÷ fecho da sessão).
 */
export function positionMarkers(data, positions = []) {
  const out = [];
  for (const p of positions) {
    const date = openDate(p.openedAt);
    if (!date || !data.length || date < data[0].date || date > data.at(-1).date) continue;
    const point = data.find((d) => d.date >= date);
    if (!point) continue;
    const scale = point.close ? point.value / Number(point.close) : 1;
    out.push({ key: `${p.positionId ?? date}-${out.length}`, date: point.date, y: Number(p.openPrice) * scale, quantity: p.quantity, openPrice: Number(p.openPrice), boughtOn: date });
  }
  return out;
}
