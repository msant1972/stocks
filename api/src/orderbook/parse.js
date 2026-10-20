import { parse as parseHtml } from 'node-html-parser';
import { EncryptedResponseError, UnexpectedFormatError, WARNING } from './errors.js';
import { marketTimeZone, zonedToUtc } from './instrument.js';
import { formatDecimal, parseDecimal } from './decimal.js';

export const DELAY_MINUTES = 15;
const UPDATED_RE = /Updated\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}):(\d{2})/;

/**
 * Número de um preço ou quantidade da Euronext: "." decimal e, a partir de 1000, "," de milhares (ex.: "1,475.00", observado
 * em 20 out. 2026 para a ASML). Só se aceitam grupos de milhares bem formados; "1,5" continua inválido.
 */
const THOUSANDS_RE = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;
export const parseEuronextNumber = (value) => {
  const t = String(value ?? '').trim();
  return parseDecimal(THOUSANDS_RE.test(t) ? t.replaceAll(',', '') : t);
};

const intOrNull = (text) => {
  const t = String(text ?? '').replace(/[,\s ]/g, '');
  return /^\d+$/.test(t) ? Number(t) : null;
};

/** Lê da tabela HTML o nº de ordens por (lado, preço), o carimbo e os totais (§3.2, §5.5). */
function readTable(html) {
  const out = { orders: new Map(), rows: 0, updated: null, totals: {} };
  if (typeof html !== 'string' || !html) return out;
  const root = parseHtml(html);
  const text = root.textContent;
  const u = UPDATED_RE.exec(text);
  if (u) out.updated = { day: +u[1], month: +u[2], year: +u[3], hour: +u[4], minute: +u[5] };
  for (const tr of root.querySelectorAll('#AwlOrderBookTableCanvas tbody tr')) {
    const td = tr.querySelectorAll('td').map((c) => c.textContent.trim());
    if (td.length < 6) continue;
    out.rows += 1;
    const bidPrice = parseEuronextNumber(td[2]);
    const askPrice = parseEuronextNumber(td[3]);
    if (bidPrice != null && intOrNull(td[0]) != null) out.orders.set(`bid|${bidPrice}`, intOrNull(td[0]));
    if (askPrice != null && intOrNull(td[5]) != null) out.orders.set(`ask|${askPrice}`, intOrNull(td[5]));
  }
  const pick = (sel) => intOrNull(root.querySelector(sel)?.textContent);
  out.totals = {
    bidQuantity: pick('.totalbar__left'), askQuantity: pick('.totalbar__right'),
    bidOrders: pick('.totalbar__bottom .text-l'), askOrders: pick('.totalbar__bottom .text-r'),
  };
  return out;
}

/**
 * Converte a resposta JSON do endpoint num OrderBook (§4, §5).
 * warn(code, message, detail) recebe os avisos não fatais.
 */
export function parseOrderBook(json, { isin, mic, url, fetchedAt = new Date(), warn = () => {} }) {
  const ctx = { isin, mic, url };
  if (json && typeof json === 'object' && 'ct' in json && 'iv' in json && 's' in json) {
    throw new EncryptedResponseError('resposta cifrada (ajax_secure); decifração não suportada nesta versão', ctx);
  }
  if (!json || typeof json !== 'object' || (!('chart_data' in json) && !('table' in json))) {
    throw new UnexpectedFormatError('resposta sem chart_data nem table', { ...ctx, excerpt: JSON.stringify(json)?.slice(0, 500) ?? String(json) });
  }

  const bids = [];
  const asks = [];
  for (const [i, item] of (Array.isArray(json.chart_data) ? json.chart_data : []).entries()) {
    const price = parseEuronextNumber(item?.price);
    const q = parseEuronextNumber(item?.qtt);
    if (price == null || q == null || price <= 0n) {
      warn(WARNING.MALFORMED_LEVEL, `nível ${i} descartado: preço ou quantidade inválidos`, { item });
      continue;
    }
    if (q === 0n) continue;
    const side = q > 0n ? 'ask' : 'bid';
    const absQ = q > 0n ? q : -q;
    const quantity = Number(absQ / 10n ** 8n);
    if (absQ % 10n ** 8n !== 0n || !Number.isSafeInteger(quantity)) {
      warn(WARNING.MALFORMED_LEVEL, `nível ${i} descartado: quantidade não inteira`, { item });
      continue;
    }
    (side === 'bid' ? bids : asks).push({ side, price, quantity, orders: null });
  }
  bids.sort((a, b) => (a.price < b.price ? 1 : a.price > b.price ? -1 : 0));
  asks.sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));

  const table = readTable(json.table);
  let unmatched = 0;
  for (const level of [...bids, ...asks]) {
    const orders = table.orders.get(`${level.side}|${level.price}`);
    if (orders == null) unmatched += 1;
    else level.orders = orders;
  }
  if (unmatched > 0) {
    warn(WARNING.ORDERS_UNMATCHED, `nº de ordens não encontrado na tabela para ${unmatched} nível(is)`, { unmatched });
  }
  const sum = (levels) => levels.reduce((s, l) => s + l.quantity, 0);
  for (const [label, total, levels] of [['compra', table.totals.bidQuantity, bids], ['venda', table.totals.askQuantity, asks]]) {
    if (total != null && total !== sum(levels)) {
      warn(WARNING.INCONSISTENCY, `total de ${label} da tabela (${total}) diferente da soma dos níveis (${sum(levels)})`, { total, sum: sum(levels) });
    }
  }

  const u = table.updated;
  return {
    isin, mic,
    bids: bids.map(toLevel), asks: asks.map(toLevel),
    updatedAt: u ? zonedToUtc(u.year, u.month, u.day, u.hour, u.minute, marketTimeZone(mic)) : null,
    fetchedAt, delayMinutes: DELAY_MINUTES, source: url,
    // Totais de ordens da tabela, usados nas estatísticas quando faltam ordens em algum nível.
    tableTotals: table.totals,
  };
}

// Preço como string decimal (precisão preservada em JSON); o valor exacto é refeito a partir dela.
const toLevel = (l) => ({ side: l.side, price: formatDecimal(l.price), quantity: l.quantity, orders: l.orders });
