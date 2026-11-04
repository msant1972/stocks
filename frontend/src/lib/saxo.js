/** Funções puras da ligação à SAXO Bank (conta de simulação). */

export const ORDER_STATUS = {
  sending: 'A enviar',
  working: 'Aberta',
  filled: 'Executada',
  expired: 'Expirada',
  cancelled: 'Cancelada',
  ended: 'Já não está aberta',
  rejected: 'Recusada',
  unknown: 'Por confirmar',
};

export const ORDER_STATUS_HELP = {
  ended: 'Já não consta das ordens abertas da SAXO e a SAXO não deu o histórico. Confirme na plataforma da SAXO.',
  unknown: 'A SAXO não respondeu ao envio. Confirme na plataforma da SAXO se a ordem foi aceite antes de a repetir.',
};

/** Avisos dos Alertas SAXO. */
export const NOTICE_KIND = { filled: 'Executada', expired: 'Expirada', cancelled: 'Cancelada', ended: 'Já não está aberta' };

/** «Compra limitada», «Venda stop», «Venda stop móvel»… */
export function orderLabel(o) {
  const side = o.side === 'buy' ? 'Compra' : 'Venda';
  return `${side} ${{ limit: 'limitada', market: 'a mercado', stop: 'stop', trailing_stop: 'stop móvel' }[o.orderType] ?? ''}`.trim();
}

/** Percentagem do stop por omissão (abaixo do preço de compra). */
export const DEFAULT_STOP_PCT = 8;

/** Preço do stop fixo e distância do stop móvel por omissão: pct % abaixo de `price`, com 4 casas no máximo. */
export function defaultStop(price, pct = DEFAULT_STOP_PCT) {
  const p = Number(price);
  if (!(p > 0)) return { price: '', distance: '' };
  const round = (v) => String(Number(v.toFixed(v >= 1 ? 2 : 4)));
  return { price: round(p * (1 - pct / 100)), distance: round(p * (pct / 100)) };
}

/**
 * Carteira virtual lado a lado com a da SAXO, por instrumento: quantidades e diferença. As posições da SAXO sem
 * correspondência na aplicação aparecem pelo símbolo da SAXO. Ordenado por símbolo.
 */
export function comparePortfolios(virtualPositions = [], saxoPositions = []) {
  const rows = new Map();
  const row = (key, symbol, instrumentId) => {
    if (!rows.has(key)) rows.set(key, { key, instrumentId, symbol, virtualQty: 0, saxoQty: 0 });
    return rows.get(key);
  };
  for (const p of virtualPositions) row(`i${p.instrumentId}`, p.symbol, p.instrumentId).virtualQty += Number(p.quantity);
  for (const p of saxoPositions) {
    const r = p.instrumentId != null ? row(`i${p.instrumentId}`, p.symbol, p.instrumentId) : row(`s${p.symbol}`, p.symbol, null);
    r.saxoQty += Number(p.quantity);
  }
  return [...rows.values()].map((r) => ({ ...r, diff: r.saxoQty - r.virtualQty })).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Sinais → ordens para a SAXO (uma por instrumento, o sinal mais recente): compras e reforços compram o orçamento ao último
 * preço; vendas vendem o que a conta SAXO tem (sem posição na SAXO, a venda é ignorada).
 */
export function signalsToOrders(signals = [], saxoPositions = [], budget = 15000) {
  const held = new Map();
  for (const p of saxoPositions) if (p.instrumentId != null) held.set(p.instrumentId, (held.get(p.instrumentId) ?? 0) + Number(p.quantity));
  const latest = new Map();
  for (const s of signals) {
    const cur = latest.get(s.instrumentId);
    if (!cur || s.date > cur.date) latest.set(s.instrumentId, s);
  }
  const out = [];
  for (const s of latest.values()) {
    const price = Number(s.lastClose);
    if (s.side === 'sell') {
      const qty = held.get(s.instrumentId) ?? 0;
      out.push({ signal: s, side: 'sell', quantity: qty, price, skip: qty > 0 ? null : 'sem posição na SAXO' });
    } else {
      const qty = price > 0 ? Math.max(1, Math.floor(budget / price)) : 0;
      out.push({ signal: s, side: 'buy', quantity: qty, price, skip: qty > 0 ? null : 'sem preço' });
    }
  }
  return out.sort((a, b) => a.signal.symbol.localeCompare(b.signal.symbol));
}

/** Preço limite escrito pelo utilizador → texto aceite pela API ("9.5"), ou null se não for válido. */
export function normaliseLimit(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  return /^\d+(\.\d{1,6})?$/.test(t) && Number(t) > 0 ? t : null;
}

/**
 * Preço limite inicial: o último preço da aplicação arredondado a 4 casas (o mais fino dos passos de preço),
 * para tirar o ruído de vírgula flutuante dos fechos (30.459999 → 30.46), sem zeros à direita.
 */
export const defaultLimit = (price) => (Number(price) > 0 ? String(Number(Number(price).toFixed(4))) : '');

/** Segundos que faltam para se poder confirmar (a SAXO só aceita 1 pedido/s a ordens). */
export const confirmWaitMs = (previewedAt, now = Date.now(), minMs = 1100) => Math.max(0, previewedAt + minMs - now);
