/**
 * Períodos do gráfico do Charts (1M a 5A). Fora do componente do gráfico, que é carregado a pedido: a página também precisa de
 * saber o período guardado, para pedir à API o histórico que o gráfico vai mostrar.
 */
export const RANGE_KEY = 'stocks.periodo';

export const RANGES = [
  { value: '1M', label: '1M', months: 1 },
  { value: '3M', label: '3M', months: 3 },
  { value: '6M', label: '6M', months: 6 },
  { value: '1A', label: '1A', months: 12 },
  { value: '2A', label: '2A', months: 24 },
  { value: '5A', label: '5A', months: 60 }, // sem atalho de teclado (1–5 são os anteriores)
];

/** Último período escolhido no gráfico (guardado no browser); 1A por omissão. */
export function readRange() {
  try {
    const saved = localStorage.getItem(RANGE_KEY);
    return RANGES.some((r) => r.value === saved) ? saved : '1A';
  } catch { return '1A'; }
}

/** Meses do período guardado. */
export const savedRangeMonths = () => RANGES.find((r) => r.value === readRange()).months;
