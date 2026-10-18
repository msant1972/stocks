/** Formatação pt-PT: «12 345,67 €», «16 out. 2026», «+2,35%». */

const MONTHS = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];

const moneyFormats = new Map();
function moneyFormat(currency, digits) {
  const key = `${currency}:${digits}`;
  if (!moneyFormats.has(key)) {
    moneyFormats.set(key, new Intl.NumberFormat('pt-PT', {
      style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
    }));
  }
  return moneyFormats.get(key);
}

const plain = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });

/** Valores chegam como strings decimais; Number só é usado para apresentação. */
export function money(value, currency = 'EUR', digits = 2) {
  if (value == null || value === '') return '—';
  return moneyFormat(currency || 'EUR', digits).format(Number(value));
}

/** Preço de uma acção: 2 casas, ou mais se o valor as tiver (ex.: 0,1234 €). */
export function price(value, currency = 'EUR') {
  if (value == null) return '—';
  const n = Number(value);
  return money(value, currency, n !== 0 && Math.abs(n) < 1 ? 4 : 2);
}

export function number(value) {
  return value == null ? '—' : plain.format(Number(value));
}

export function quantity(value) {
  return value == null ? '—' : integer.format(Number(value));
}

export function pct(value) {
  if (value == null) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${plain.format(n)}%`;
}

/** Valor monetário com sinal explícito: «+120,00 €». */
export function signedMoney(value, currency = 'EUR') {
  if (value == null) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${money(value, currency)}`;
}

/** 'AAAA-MM-DD' -> «16 out. 2026». */
export function date(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function shortDate(iso) {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** Instante ISO -> «16 out. 2026, 19:05» na hora local. */
export function dateTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}, ${hh}:${mm}`;
}

/** Dias de calendário desde a data 'AAAA-MM-DD' até hoje. */
export function daysSince(iso) {
  if (!iso) return null;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

/** Sinal textual de uma variação, para não depender só da cor. */
export function trend(value) {
  const n = Number(value);
  if (value == null || n === 0) return { label: 'Sem variação', tone: '' };
  return n > 0 ? { label: 'Subida', tone: 'positive' } : { label: 'Descida', tone: 'negative' };
}

export const ALERT_KIND_LABEL = {
  close_above: 'Fecho acima de',
  close_below: 'Fecho abaixo de',
  change_up: 'Subida diária de pelo menos',
  change_down: 'Descida diária de pelo menos',
};

/** Pré-visualização da condição em linguagem natural (guia, secção 5.7). */
export function describeRule(kind, threshold, symbol, currency = 'EUR') {
  const name = symbol || '[instrumento]';
  if (!threshold) return null;
  switch (kind) {
    case 'close_above': return `Avisar quando o fecho diário de ${name} for superior a ${money(threshold, currency)}.`;
    case 'close_below': return `Avisar quando o fecho diário de ${name} for inferior a ${money(threshold, currency)}.`;
    case 'change_up': return `Avisar quando ${name} subir pelo menos ${number(threshold)}% face à sessão anterior.`;
    case 'change_down': return `Avisar quando ${name} descer pelo menos ${number(threshold)}% face à sessão anterior.`;
    default: return null;
  }
}
