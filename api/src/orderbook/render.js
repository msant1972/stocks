import { decimalPlaces, parseDecimal } from './decimal.js';
import { computeStats } from './stats.js';
import { marketTimeZone } from './instrument.js';

export const SOURCE_NOTE = 'Fonte: Euronext, atraso 15 min';

const ANSI = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m' };

/**
 * Livro de ofertas em texto (especificação §7.1 e §7.2).
 * opts: { levels, layout: 'side-by-side' | 'ladder', locale: 'pt-PT', color }
 */
export function renderText(book, stats = computeStats(book), opts = {}) {
  const { levels = Infinity, layout = 'side-by-side', locale = 'pt-PT' } = opts;
  const color = opts.color ?? (!process.env.NO_COLOR && process.stdout?.isTTY === true);
  const paint = (c, s) => (color ? `${ANSI[c]}${s}${ANSI.reset}` : s);

  const id = `${book.isin}-${book.mic}`;
  const header = `${book.isin} · ${book.mic} · ${book.updatedAt ? `atualizado ${formatStamp(book.updatedAt, book.mic)}` : 'sem carimbo'} (atraso ${book.delayMinutes} min)`;
  if (book.bids.length === 0 && book.asks.length === 0) {
    return `${header}\n\nSem ofertas disponíveis para ${id}.\n\n${SOURCE_NOTE}`;
  }

  // Casas decimais do preço: o máximo observado no livro, com mínimo de 2 (§7.1).
  const places = Math.max(2, ...[...book.bids, ...book.asks].map((l) => decimalPlaces(parseDecimal(l.price))));
  const priceFmt = new Intl.NumberFormat(locale, { minimumFractionDigits: places, maximumFractionDigits: places });
  const intFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: 'always' });
  const num2 = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const p = (s) => priceFmt.format(Number(s));
  const q = (n) => intFmt.format(n).replace(/ | /g, ' ');

  const bids = book.bids.slice(0, levels);
  const asks = book.asks.slice(0, levels);
  const lines = [header, ''];
  if (stats.crossed) lines.push(paint('yellow', 'LIVRO CRUZADO (provável leilão)'), '');

  if (layout === 'ladder') {
    const maxQ = Math.max(...bids.map((l) => l.quantity), ...asks.map((l) => l.quantity), 1);
    const bar = (n) => '█'.repeat(Math.max(1, Math.round((n / maxQ) * 30)));
    for (const l of [...asks].reverse()) lines.push(paint('red', `${p(l.price).padStart(10)}  ${q(l.quantity).padStart(10)}  ${bar(l.quantity)}`));
    lines.push(`${''.padStart(10)}  ${paint('dim', `── spread ${stats.spread == null ? '—' : p(stats.spread)} ──`)}`);
    for (const l of bids) lines.push(paint('green', `${p(l.price).padStart(10)}  ${q(l.quantity).padStart(10)}  ${bar(l.quantity)}`));
  } else {
    const rows = Math.max(bids.length, asks.length);
    const W = { o: 3, q: 11, p: Math.max(7, ...[...bids, ...asks].map((l) => p(l.price).length)) };
    const left = (l) => (l ? `${String(l.orders ?? '').padStart(W.o)}  ${q(l.quantity).padStart(W.q)}  ${p(l.price).padStart(W.p)}` : ''.padStart(W.o + W.q + W.p + 4));
    const right = (l) => (l ? `${p(l.price).padEnd(W.p)}  ${q(l.quantity).padStart(W.q)}  ${String(l.orders ?? '').padStart(W.o)}` : '');
    const leftW = W.o + W.q + W.p + 4;
    lines.push(`${'#'.padStart(W.o)}  ${'Qtd compra'.padStart(W.q)}  ${'Compra'.padStart(W.p)} │ ${'Venda'.padEnd(W.p)}  ${'Qtd venda'.padStart(W.q)}  ${'#'.padStart(W.o)}`);
    for (let i = 0; i < rows; i++) {
      lines.push(`${paint('green', left(bids[i]))} │ ${paint('red', right(asks[i]))}`);
    }
    lines.push(`${'─'.repeat(leftW + 1)}┼${'─'.repeat(W.p + W.q + W.o + 5)}`);
    const totLeft = `${String(stats.bidOrders ?? '').padStart(W.o)}  ${q(stats.bidVolume).padStart(W.q)}  ${''.padStart(W.p)}`;
    const totRight = `${''.padEnd(W.p)}  ${q(stats.askVolume).padStart(W.q)}  ${String(stats.askOrders ?? '').padStart(W.o)}`;
    lines.push(`${totLeft} │ ${totRight}`);
  }

  const parts = [];
  if (stats.spread != null) parts.push(`Spread ${p(stats.spread)} (${num2.format(stats.spreadPct * 100)} %)`);
  if (stats.mid != null) parts.push(`Mid ${p(stats.mid)}`);
  if (stats.imbalance != null) {
    const pressure = stats.imbalance > 0.1 ? ' (pressão compradora)' : stats.imbalance < -0.1 ? ' (pressão vendedora)' : '';
    parts.push(`Desequilíbrio ${num2.format(stats.imbalance).replace('-', '−')}${pressure}`);
  }
  lines.push('', parts.join(' · '), SOURCE_NOTE);
  return lines.join('\n');
}

/** «19/10/2026 16:40» na hora do mercado. */
export function formatStamp(date, mic) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('pt-PT', {
    timeZone: marketTimeZone(mic), day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}
