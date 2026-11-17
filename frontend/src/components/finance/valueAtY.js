/**
 * Valor no eixo vertical à altura `y` (em píxeis, a partir do topo do painel), com a área do gráfico lida do próprio SVG (o
 * rectângulo de recorte que o Recharts desenha) e o domínio do eixo. null fora da área do gráfico.
 */
export function valueAtY(y, plot, domain) {
  if (!plot || !domain || !(plot.height > 0) || y < plot.y || y > plot.y + plot.height) return null;
  const [min, max] = domain;
  return max - ((y - plot.y) / plot.height) * (max - min);
}
