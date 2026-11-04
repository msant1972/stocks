/** Formatação do perfil da empresa (painel «Empresa» do Charts). */

const nf = (digits) => new Intl.NumberFormat('pt-PT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const SYMBOL = { EUR: '€', USD: 'US$', GBP: '£', CHF: 'CHF' };

/** Valores grandes em português: «14,3 mil milhões €», «850,2 milhões €», «12 345 €». */
export function bigMoney(value, currency = 'EUR') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  const a = Math.abs(v);
  const cur = SYMBOL[currency] ?? currency ?? '';
  if (a >= 1e9) return `${nf(1).format(v / 1e9)} mil milhões ${cur}`.trim();
  if (a >= 1e6) return `${nf(1).format(v / 1e6)} milhões ${cur}`.trim();
  return `${nf(0).format(v)} ${cur}`.trim();
}

/** Eixo dos mini-gráficos: «20 mM» (mil milhões) ou «850 M» (milhões). */
export function axisMoney(value) {
  const a = Math.abs(value);
  if (a >= 1e9) return `${nf(a >= 1e10 ? 0 : 1).format(value / 1e9)} mM`;
  if (a >= 1e6) return `${nf(0).format(value / 1e6)} M`;
  return nf(0).format(value);
}

/** Percentagem a partir de uma fracção (0.0428 → «4,28 %») ou de um valor já em % (fraction = false). */
export function pctOf(value, { fraction = true, digits = 2 } = {}) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${nf(digits).format(fraction ? Number(value) * 100 : Number(value))} %`;
}

/** Rácio com 2 casas («14,08»), ou «—». Valores negativos do P/E (prejuízo) mostram-se como «n.s.». */
export function ratio(value, { negativeIsNa = false } = {}) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  if (negativeIsNa && Number(value) < 0) return 'n.s.';
  return nf(2).format(Number(value));
}

/** Posição (0 a 1) do preço no intervalo de 52 semanas, ou null. */
export function rangePosition(price, low, high) {
  if ([price, low, high].some((v) => v == null)) return null;
  const p = Number(price);
  const lo = Number(low);
  const hi = Number(high);
  if (![p, lo, hi].every(Number.isFinite) || hi <= lo) return null;
  return Math.min(1, Math.max(0, (p - lo) / (hi - lo)));
}

/** Resumo curto (até `max` caracteres, a cortar numa frase ou palavra) e se foi cortado. */
export function shortSummary(text, max = 420) {
  const t = String(text ?? '').trim();
  if (t.length <= max) return { text: t, cut: false };
  const head = t.slice(0, max);
  const dot = head.lastIndexOf('. ');
  const cutAt = dot > max * 0.5 ? dot + 1 : head.lastIndexOf(' ');
  return { text: `${head.slice(0, cutAt > 0 ? cutAt : max).trim()}…`, cut: true };
}
