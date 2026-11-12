/**
 * Atalhos de teclado do gráfico: 1–5 escolhem o período, 6–0 mostram ou escondem as médias (pela ordem dos
 * indicadores), T alterna velas e linha, V o volume, R o RSI14 e M o momento. Devolve a acção, ou null se a tecla não é um atalho.
 */
export function chartShortcut(key) {
  if (/^[1-5]$/.test(key)) return { type: 'range', index: Number(key) - 1 };
  if (/^[6-90]$/.test(key)) return { type: 'average', index: (Number(key) + 9) % 10 - 5 };
  switch (key.toLowerCase()) {
    case 't': return { type: 'candles' };
    case 'v': return { type: 'volume' };
    case 'r': return { type: 'rsi' };
    case 'm': return { type: 'momentum' };
    default: return null;
  }
}
