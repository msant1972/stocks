/** Formatação do perfil da empresa (painel «Empresa» do Charts). */

const nf = (digits) => new Intl.NumberFormat('pt-PT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const SYMBOL = { EUR: '€', USD: 'US$', GBP: '£', CHF: 'CHF' };

/** Valores grandes em português: «14,3 mil milhões €», «850,2 milhões €», «12 345 €». */
export function bigMoney(value, currency = 'EUR') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  const a = Math.abs(v);
  const cur = SYMBOL[currency] ?? currency ?? '';
  if (a >= 1e12) return `${nf(2).format(v / 1e12)} biliões ${cur}`.trim();
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

/** Título do P/E estimado, com o ano fiscal da estimativa: «P/E (estimado 2027)». */
export const forwardPeLabel = (year) => (year ? `P/E (estimado ${year})` : 'P/E (estimado)');

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

/** Veredictos da secção «Valorização»: texto e classe do distintivo (o texto diz sempre o estado, nunca só a cor). */
export const VERDICT = {
  cheap: { label: 'Barato', badge: 'badge-positive' },
  fair: { label: 'Em linha', badge: '' },
  expensive: { label: 'Caro', badge: 'badge-negative' },
  insufficient: { label: 'Dados insuficientes', badge: '' },
};

/** «Barato em 2 de 4 critérios», «Caro em 3 de 3 critérios», «Em linha (1 barato, 1 caro, 2 em linha)». */
export function verdictSentence(summary) {
  if (!summary || summary.verdict === 'insufficient') return 'Há menos de dois critérios com dados para concluir.';
  const { verdict, cheap, expensive, fair, total } = summary;
  const crit = (k) => `${k} de ${total} critério${total === 1 ? '' : 's'}`;
  if (verdict === 'cheap') return `Barato em ${crit(cheap)}${expensive ? `; caro em ${expensive}` : ''}.`;
  if (verdict === 'expensive') return `Caro em ${crit(expensive)}${cheap ? `; barato em ${cheap}` : ''}.`;
  const parts = [cheap && `${cheap} barato`, expensive && `${expensive} caro`, fair && `${fair} em linha`].filter(Boolean);
  return `Sem maioria: ${parts.join(', ')} (de ${total}).`;
}

/** Fracção com sinal: 0.184 → «+18,4 %». */
export function signedPctOf(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const v = Number(value) * 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(digits).format(Math.abs(v))} %`;
}

/** Recomendação média dos analistas (Yahoo) em português. */
export const RECOMMENDATION = {
  strong_buy: 'Compra forte', buy: 'Comprar', hold: 'Manter', underperform: 'Abaixo do mercado', sell: 'Vender', strong_sell: 'Venda forte',
};

/** «mais barato do que 78 % das 31 empresas» a partir da barateza (fracção dos pares mais caros). */
export function peerPosition(cheapness, peers) {
  if (cheapness == null) return '';
  const pct = Math.round(cheapness * 100);
  return pct >= 50
    ? `mais barato do que ${pct} % das ${peers} empresas do sector`
    : `mais caro do que ${100 - pct} % das ${peers} empresas do sector`;
}

/** Valor de um indicador da valorização: rácios com 1 casa («14,1×»), rendimentos em % («3,4 %»). */
export function metricValue(key, value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return key === 'dividendYield' || key === 'fcfYield' ? `${nf(1).format(value)} %` : `${nf(1).format(value)}×`;
}
