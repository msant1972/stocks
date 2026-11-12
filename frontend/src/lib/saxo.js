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
 * Sinais → ordens para a SAXO (uma por instrumento, o sinal mais recente): compras e reforços compram o orçamento ao último
 * preço; vendas vendem o que a conta SAXO tem (sem posição na SAXO, a venda é ignorada).
 */
export function signalsToOrders(signals = [], saxoPositions = [], budget = 15000) {
  const held = heldBySaxo(saxoPositions);
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


// ---------- Correspondência do catálogo com a SAXO ----------

/** Estado da correspondência de um instrumento: texto, ajuda e tom do distintivo. */
export const MATCH_STATUS = {
  linked: { label: 'Ligado', tone: 'badge-positive', help: 'Instrumento da SAXO confirmado: negociável e na mesma moeda.' },
  unchecked: { label: 'Por procurar', tone: '', help: 'Ainda não foi procurado na SAXO (corra «Ligar o catálogo»).' },
  ambiguous: { label: 'Ambíguo', tone: 'badge-warning', help: 'Vários candidatos na bolsa certa, ou o nome não coincide: escolha o certo.' },
  other_market: { label: 'Só noutra bolsa', tone: 'badge-warning', help: 'A SAXO só o tem noutra bolsa ou moeda: escolha um candidato ou deixe sem ligação.' },
  not_found: { label: 'Não encontrado', tone: 'badge-negative', help: 'Nenhum instrumento parecido na SAXO. Pode indicar o Uic à mão.' },
  not_tradable: { label: 'Não negociável', tone: 'badge-negative', help: 'A SAXO diz que não é negociável nesta conta (ou mudou de moeda).' },
  error: { label: 'Erro', tone: 'badge-negative', help: 'A verificação falhou; tente de novo.' },
};

export const MATCH_ORDER = ['linked', 'unchecked', 'ambiguous', 'other_market', 'not_found', 'not_tradable', 'error'];

/**
 * Filtro da tabela de correspondência. view: 'todo' (por resolver: tudo menos ligado), 'linked' ou 'all'.
 * q: procura no símbolo, nome e símbolo/descrição da SAXO. Os por resolver aparecem primeiro.
 */
export function filterMatches(items, { view = 'todo', q = '' } = {}) {
  const needle = q.trim().toLowerCase();
  const rank = (s) => (s === 'linked' ? 2 : s === 'unchecked' ? 1 : 0);
  return items
    .filter((i) => (view === 'all' ? true : view === 'linked' ? i.status === 'linked' : i.status !== 'linked'))
    .filter((i) => !needle || [i.symbol, i.name, i.saxo?.symbol, i.saxo?.description].some((t) => String(t ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.symbol.localeCompare(b.symbol));
}

/** Texto de um candidato da SAXO: «BAYN:xetr — Bayer AG · FSE · EUR · nome 100 %». */
export function candidateLabel(c) {
  const score = c.nameScore == null ? '' : ` · nome ${Math.round(c.nameScore * 100)} %`;
  return `${c.symbol} — ${c.description ?? 'sem descrição'} · ${c.exchangeId ?? '?'} · ${c.currency ?? '?'}${score}`;
}


// ---------- Automação ----------

/** Estado de uma ordem enviada pela automação, tal como a SAXO o indica. */
export const AUTOMATION_STATUS = {
  sending: { label: 'A enviar', tone: '' },
  working: { label: 'À espera', tone: 'badge-accent' },
  filled: { label: 'Executada', tone: 'badge-positive' },
  cancelled: { label: 'Cancelada', tone: 'badge-warning' },
  expired: { label: 'Expirada', tone: 'badge-warning' },
  rejected: { label: 'Recusada', tone: 'badge-negative' },
  ended: { label: 'Terminada', tone: '' },
  unknown: { label: 'Por confirmar', tone: 'badge-warning' },
};

/** Ordens que chegaram a ser criadas e sinais que ficaram sem ordem. */
export function splitAutomationItems(items = []) {
  return { sent: items.filter((i) => i.order), notSent: items.filter((i) => !i.order) };
}

/** Pormenor do estado: quantidade e preço executados, ou o motivo dado pela SAXO. */
export function automationState(item) {
  const o = item.order;
  if (o?.status === 'filled' && o.filledQuantity != null) {
    return `${o.filledQuantity.toLocaleString('pt-PT')} a ${Number(o.fillPrice).toLocaleString('pt-PT', { maximumFractionDigits: 4 })}`;
  }
  return item.message ?? null;
}

/** Resumo de uma execução: «3 ordens enviadas, 1 sinal ignorado», ou o motivo da falha. */
export function automationRunText(run) {
  if (run.status === 'running') return 'a decorrer.';
  if (run.status === 'failed') return `não correu: ${run.detail ?? 'erro desconhecido'}.`;
  const c = run.counts ?? {};
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [];
  if (c.sent) parts.push(plural(c.sent, 'ordem enviada', 'ordens enviadas'));
  if (c.skipped) parts.push(plural(c.skipped, 'sinal ignorado', 'sinais ignorados'));
  if (c.failed) parts.push(plural(c.failed, 'sinal falhado', 'sinais falhados'));
  if (c.late) parts.push(plural(c.late, 'sinal ficou para a abertura seguinte (depois das 16:35)', 'sinais ficaram para a abertura seguinte (depois das 16:35)'));
  return parts.length ? `${parts.join(', ')}.` : 'sem sinais novos.';
}

/** Unidades detidas por instrumento nas posições da conta SAXO (uma posição por compra). */
export function heldBySaxo(positions = []) {
  const held = new Map();
  for (const p of positions) if (p.instrumentId != null) held.set(p.instrumentId, (held.get(p.instrumentId) ?? 0) + Number(p.quantity));
  return held;
}

/**
 * «Vender Tudo» (emergência): uma ordem de venda a mercado por instrumento, com a soma das posições abertas desse instrumento
 * (a SAXO pode ter várias posições do mesmo). As posições de instrumentos que a aplicação não conhece não se vendem aqui:
 * aparecem em `skipped` (venda na plataforma da SAXO). Ordem por valor de mercado, as maiores primeiro.
 */
export function sellAllPlan(positions = []) {
  const byId = new Map();
  const skipped = [];
  for (const p of positions) {
    if (!(Number(p.quantity) > 0)) continue;
    if (p.instrumentId == null) { skipped.push(p.symbol ?? '?'); continue; }
    const cur = byId.get(p.instrumentId) ?? { instrumentId: p.instrumentId, symbol: p.symbol, name: p.name ?? null, currency: p.currency, quantity: 0, marketValue: 0 };
    cur.quantity += Number(p.quantity);
    cur.marketValue += Number(p.marketValue ?? 0);
    byId.set(p.instrumentId, cur);
  }
  return { orders: [...byId.values()].sort((a, b) => b.marketValue - a.marketValue || a.symbol.localeCompare(b.symbol)), skipped };
}

/** «Vender Tudo»: uma ordem a cada 6 segundos (10 por minuto), para a SAXO não recusar por excesso de pedidos. */
export const SELL_ALL_SPACING_MS = 6000;
/** Se a SAXO ainda responder «demasiados pedidos», espera mais e repete (no máximo RATE_RETRIES vezes por ordem). */
export const SELL_ALL_RATE_WAIT_MS = 20_000;
export const SELL_ALL_RATE_RETRIES = 3;

/** O erro da API é o limite de pedidos da SAXO (429 SAXO_RATE_LIMITED)? */
export const isRateLimited = (err) => err?.code === 'SAXO_RATE_LIMITED' || err?.status === 429;

/** Tempo estimado do «Vender Tudo» para n ordens, em segundos (a primeira sai logo). */
export const sellAllSeconds = (n, spacingMs = SELL_ALL_SPACING_MS) => Math.max(0, n - 1) * Math.round(spacingMs / 1000);

/** Ordens de compra ainda abertas (a cancelar antes de vender tudo, para não voltarem a comprar). */
export const openBuyOrders = (orders = []) => orders.filter((o) => o.side === 'buy' && o.status === 'working');
