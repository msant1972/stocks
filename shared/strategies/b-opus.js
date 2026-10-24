/**
 * B-Opus — tendência e momentum por instrumento (docs/arquitectura/B-Opus.md).
 *
 * Em cada revisão semanal, sem posição, compra 15 000 € na abertura seguinte quando a acção está em tendência
 * de alta (fecho e SMA50 acima da SMA200), com momentum positivo (M1 = (SMA10 − SMA125) / ATR22 e
 * M2 = momentum 12-1 / volatilidade), liquidez mínima e sem arrefecimento após um stop. Reforça com mais
 * 15 000 € na abertura seguinte sempre que o fecho sobe mais de 10% face ao último lote (até 5 reforços).
 * Sai por stop chandelier diário (máximo desde a entrada − 4 × ATR, só sobe) ou, na revisão semanal, por falta
 * de liquidez, quebra de tendência, perda de momentum ou stop temporal (venda na abertura seguinte).
 * Uma posição de cada vez, sem comissões.
 *
 * Versão B (24 out. 2026): sem o filtro do Efficiency Ratio, stop de 4 × ATR (era 3) e reforços, depois da
 * análise de todos os instrumentos (docs/arquitectura/B-Opus.md, secção 15).
 *
 * Indicadores e decisões sobre a série ajustada (OHLC × adjClose/close); execução e resultados em preços
 * reais, como a A-Momentum. Sem lookahead: a decisão no fecho de t usa só dados até t.
 */
import { rollingMean } from '../momentum.js';

export const DEFAULT_OPTIONS = {
  budget: 15000,
  smaTrendFast: 50, smaTrendSlow: 200, m1Fast: 10, m1Slow: 125, atrN: 22,
  m2Lookback: 252, m2Skip: 21, erWindow: 60, adxN: 14, cmfN: 20,
  p90Window: 504, p90MinObs: 252, minHistory: 253,
  minTradedValue: 5000000,
  trendStrength: 'none', erThreshold: 0.25, adxThreshold: 20, cooldownSessions: 10,
  volumeConfirmation: false, overextensionBlock: false,
  gapProtectAtr: 1.0, pullbackEntry: false, pullbackAtr: 1.0, pullbackWindow: 5,
  stopMult: 4.0, useTimeStop: true, timeStopSessions: 20, timeStopAtr: 1.0, partialTakeProfit: false,
  review: 'weekly',
  entryReview: 'weekly',       // 'weekly' (só nas revisões) | 'daily' (entradas em qualquer sessão; saídas semanais)
  stopFrom: 'high',            // chandelier a partir do máximo ('high') ou do maior fecho ('close')
  addOnGain: 0.10,             // reforço de mais `budget` quando o fecho sobe mais do que isto face ao último lote (0 = sem reforços)
  maxAdds: 5,                  // máximo de reforços por posição (0 = sem limite)
};

/** Regras da especificação original (Efficiency Ratio, stop de 3 × ATR, sem reforços), para comparação. */
export const ORIGINAL_OPTIONS = { trendStrength: 'er', stopMult: 3.0, addOnGain: 0, maxAdds: 0 };

const ENUMS = { trendStrength: ['er', 'adx', 'none'], review: ['weekly', 'biweekly', 'monthly'], entryReview: ['weekly', 'daily'], stopFrom: ['high', 'close'] };

/** Valida e completa as opções (chaves desconhecidas, tipos e gamas → erro). */
export function resolveOptions(options = {}) {
  const { from, ...rest } = options;
  for (const k of Object.keys(rest)) {
    if (!(k in DEFAULT_OPTIONS)) throw new Error(`B-Opus: opção desconhecida «${k}»`);
    const def = DEFAULT_OPTIONS[k];
    const v = rest[k];
    if (ENUMS[k]) {
      if (!ENUMS[k].includes(v)) throw new Error(`B-Opus: «${k}» deve ser ${ENUMS[k].join(', ')}`);
    } else if (typeof def === 'boolean') {
      if (typeof v !== 'boolean') throw new Error(`B-Opus: «${k}» deve ser verdadeiro ou falso`);
    } else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new Error(`B-Opus: «${k}» deve ser um número não negativo`);
    }
  }
  if (from != null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('B-Opus: «from» deve ser AAAA-MM-DD');
  return { ...DEFAULT_OPTIONS, ...rest, from: from ?? null };
}

// ---------- Dados ----------

/**
 * Série ajustada e limpa: O, H, L, C ajustados por f = adjClose/close; close e volume brutos; f para
 * converter preços ajustados em reais. Ignora sessões sem OHLC positivo ou sem adjClose.
 */
export function prepare(quotes) {
  const out = [];
  let skipped = 0;
  let corrected = 0;
  for (const q of quotes) {
    const open = Number(q.open); const high = Number(q.high); const low = Number(q.low);
    const close = Number(q.close); const adj = Number(q.adjClose ?? q.adj_close);
    if (![open, high, low, close, adj].every((v) => Number.isFinite(v) && v > 0)) { skipped += 1; continue; }
    const f = adj / close;
    let H = high * f; let L = low * f; const O = open * f; const C = adj;
    if (O > H || O < L || C > H || C < L) {
      H = Math.max(O, H, L, C); L = Math.min(O, H, L, C); corrected += 1;
    }
    out.push({ date: q.date, O, H, L, C, f, closeRaw: close, volume: Number(q.volume) || 0 });
  }
  return { bars: out, dataQuality: { sessions: quotes.length, skipped, corrected } };
}

// ---------- Indicadores (funções puras, alinhadas com as sessões; null sem dados suficientes) ----------

export const sma = (values, n) => rollingMean(values, n);

/** True range e ATR de Wilder (semente: média dos primeiros n TR). */
export function atrWilder(bars, n) {
  const out = new Array(bars.length).fill(null);
  let sum = 0;
  let atr = null;
  for (let i = 0; i < bars.length; i++) {
    const { H, L } = bars[i];
    const tr = i === 0 ? H - L : Math.max(H - L, Math.abs(H - bars[i - 1].C), Math.abs(L - bars[i - 1].C));
    if (i < n) {
      sum += tr;
      if (i === n - 1) { atr = sum / n; out[i] = atr; }
    } else {
      atr += (tr - atr) / n;
      out[i] = atr;
    }
  }
  return out;
}

/** Desvio-padrão amostral (n − 1) numa janela móvel. */
function rollingStd(values, n) {
  const out = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let mean = 0;
    for (let k = i - n + 1; k <= i; k++) mean += values[k];
    mean /= n;
    let ss = 0;
    for (let k = i - n + 1; k <= i; k++) ss += (values[k] - mean) ** 2;
    out[i] = Math.sqrt(ss / (n - 1));
  }
  return out;
}

/** M2 = (C[t−skip] / C[t−lookback] − 1) / (desvio dos últimos `lookback` retornos × √252). */
export function m2Series(closes, lookback, skip) {
  const rets = closes.map((c, i) => (i === 0 ? null : c / closes[i - 1] - 1));
  const out = new Array(closes.length).fill(null);
  const std = rollingStd(rets.slice(1), lookback); // std[j] usa rets[j−lookback+2 .. j+1]
  for (let t = lookback; t < closes.length; t++) {
    const s = std[t - 1];
    if (s == null || s === 0) continue;
    out[t] = (closes[t - skip] / closes[t - lookback] - 1) / (s * Math.sqrt(252));
  }
  return out;
}

/** Efficiency Ratio de Kaufman. */
export function efficiencyRatio(closes, n) {
  const out = new Array(closes.length).fill(null);
  for (let t = n; t < closes.length; t++) {
    let path = 0;
    for (let i = t - n + 1; i <= t; i++) path += Math.abs(closes[i] - closes[i - 1]);
    out[t] = path === 0 ? 0 : Math.abs(closes[t] - closes[t - n]) / path;
  }
  return out;
}

/** ADX de Wilder. */
export function adxWilder(bars, n) {
  const len = bars.length;
  const out = new Array(len).fill(null);
  if (len <= n) return out;
  const tr = [0]; const pdm = [0]; const mdm = [0];
  for (let i = 1; i < len; i++) {
    const up = bars[i].H - bars[i - 1].H;
    const down = bars[i - 1].L - bars[i].L;
    pdm.push(up > down && up > 0 ? up : 0);
    mdm.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(bars[i].H - bars[i].L, Math.abs(bars[i].H - bars[i - 1].C), Math.abs(bars[i].L - bars[i - 1].C)));
  }
  let sTr = 0; let sP = 0; let sM = 0;
  for (let i = 1; i <= n; i++) { sTr += tr[i]; sP += pdm[i]; sM += mdm[i]; }
  const dx = [];
  const dxAt = () => {
    const pdi = sTr === 0 ? 0 : (100 * sP) / sTr;
    const mdi = sTr === 0 ? 0 : (100 * sM) / sTr;
    return pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
  };
  dx[n] = dxAt();
  for (let i = n + 1; i < len; i++) {
    sTr += tr[i] - sTr / n; sP += pdm[i] - sP / n; sM += mdm[i] - sM / n;
    dx[i] = dxAt();
  }
  let adx = null;
  let acc = 0;
  for (let i = n; i < len; i++) {
    if (i < 2 * n - 1) { acc += dx[i]; continue; }
    if (i === 2 * n - 1) { acc += dx[i]; adx = acc / n; } else adx += (dx[i] - adx) / n;
    out[i] = adx;
  }
  return out;
}

/** Chaikin Money Flow. */
export function cmf(bars, n) {
  const out = new Array(bars.length).fill(null);
  for (let t = n - 1; t < bars.length; t++) {
    let mf = 0; let vol = 0;
    for (let i = t - n + 1; i <= t; i++) {
      const { H, L, C, volume } = bars[i];
      const mfm = H === L ? 0 : ((C - L) - (H - C)) / (H - L);
      mf += mfm * volume; vol += volume;
    }
    out[t] = vol === 0 ? 0 : mf / vol;
  }
  return out;
}

/** Percentil p (interpolação linear) dos valores não nulos das últimas `window` sessões, com `minObs`. */
export function rollingPercentile(values, window, minObs, p = 0.9) {
  const out = new Array(values.length).fill(null);
  for (let t = 0; t < values.length; t++) {
    const w = values.slice(Math.max(0, t - window + 1), t + 1).filter((v) => v != null).sort((a, b) => a - b);
    if (w.length < minObs) continue;
    const pos = (w.length - 1) * p;
    const lo = Math.floor(pos);
    out[t] = w[lo] + (w[Math.min(lo + 1, w.length - 1)] - w[lo]) * (pos - lo);
  }
  return out;
}

/** Todos os indicadores da estratégia sobre a série preparada. */
export function indicators(bars, o) {
  const C = bars.map((b) => b.C);
  const smaFast = sma(C, o.smaTrendFast);
  const smaSlow = sma(C, o.smaTrendSlow);
  const s10 = sma(C, o.m1Fast);
  const s125 = sma(C, o.m1Slow);
  const atr = atrWilder(bars, o.atrN);
  const m1 = C.map((_, i) => (s10[i] == null || s125[i] == null || !atr[i] ? null : (s10[i] - s125[i]) / atr[i]));
  return {
    smaFast, smaSlow, atr, m1,
    m2: m2Series(C, o.m2Lookback, o.m2Skip),
    er: efficiencyRatio(C, o.erWindow),
    vmn: sma(bars.map((b) => b.closeRaw * b.volume), 50),
    adx: o.trendStrength === 'adx' ? adxWilder(bars, o.adxN) : null,
    cmf: o.volumeConfirmation ? cmf(bars, o.cmfN) : null,
    p90: o.overextensionBlock || o.partialTakeProfit ? rollingPercentile(m1, o.p90Window, o.p90MinObs) : null,
  };
}

// ---------- Calendário de revisões ----------

/** Chave da semana ISO (ano ISO e número da semana) de uma data AAAA-MM-DD. */
export function isoWeekKey(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // quinta-feira da mesma semana
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Sessões de revisão: a última sessão de cada semana ISO (ou de cada mês). A última sessão dos dados só é
 * revisão se for sexta-feira (semanal) ou o último dia útil do mês (mensal), porque ainda não se sabe se
 * haverá outra sessão nesse período. biweekly: semanas alternadas, começando pela primeira.
 */
export function reviewFlags(dates, review) {
  const keyOf = review === 'monthly' ? (d) => d.slice(0, 7) : isoWeekKey;
  const flags = dates.map((d, i) => {
    if (i < dates.length - 1) return keyOf(dates[i + 1]) !== keyOf(d);
    const dt = new Date(`${d}T00:00:00Z`);
    if (review === 'monthly') {
      const next = new Date(dt); next.setUTCDate(dt.getUTCDate() + (dt.getUTCDay() === 5 ? 3 : 1));
      return next.getUTCMonth() !== dt.getUTCMonth();
    }
    return dt.getUTCDay() === 5;
  });
  if (review !== 'biweekly') return flags;
  let n = 0;
  return flags.map((f) => (f ? n++ % 2 === 0 : false));
}

// ---------- Simulação ----------

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Simula a B-Opus num instrumento. quotes: sessões em ordem cronológica com date, open, high, low, close
 * (brutos), adjClose e volume. options.from: primeira data em que a estratégia pode comprar (os
 * indicadores usam todo o histórico recebido). Devolve o formato comum do registo de estratégias.
 */
export function backtest(quotes, options = {}) {
  const o = resolveOptions(options);
  const { bars, dataQuality } = prepare(quotes);
  const ind = indicators(bars, o);
  const review = reviewFlags(bars.map((b) => b.date), o.review);
  const warm = Math.max(o.minHistory, o.smaTrendSlow, o.m2Lookback + 1) - 1;
  const fromPos = o.from ? bars.findIndex((b) => b.date >= o.from) : 0;
  const fromIdx = fromPos < 0 ? -1 : Math.max(warm, fromPos);
  const startIdx = fromIdx >= 0 && fromIdx < bars.length ? fromIdx : -1;

  const trades = [];
  const signals = [];
  const blocked = { liquidity: 0, trend: 0, momentum: 0, trendStrength: 0, cooldown: 0, volume: 0, overextension: 0 };
  const exitReasons = { stop: 0, trend_break: 0, momentum_loss: 0, liquidity: 0, time_stop: 0 };
  let gapCancels = 0;
  let peakCost = 0;
  let pos = null;          // posição aberta
  let pendingBuy = null;   // { reviewIdx, atr, closeAdj, limit?, validUntil? }
  let pendingSell = null;  // { reason } ou { partial: true }
  let lastStopIdx = null;

  const real = (adjPrice, i) => adjPrice / bars[i].f;

  const closePos = (i, adjPrice, reason) => {
    const price = real(adjPrice, i);
    const proceeds = round2(pos.quantity * price);
    const partial = pos.partialSales.reduce((s, p) => s + p.proceeds, 0);
    const total = round2(proceeds + partial);
    const bought = pos.lots.reduce((s, l) => s + l.quantity, 0);
    trades.push({
      buyDate: pos.buyDate, sellDate: bars[i].date, quantity: bought, cost: pos.cost,
      avgPrice: pos.cost / bought, lots: pos.lots,
      reinforcements: pos.lots.length - 1, sellPrice: price, proceeds: total, reason,
      initialStop: real(pos.initialStop, pos.entryIdx), partialSales: pos.partialSales,
      pnl: round2(total - pos.cost), pnlPct: (total / pos.cost - 1) * 100,
    });
    signals.push({ date: bars[i].date, side: 'sell', reason, price });
    if (exitReasons[reason] != null) exitReasons[reason] += 1;
    if (reason === 'stop') lastStopIdx = i;
    pos = null;
    pendingSell = null;
  };

  const openPos = (i, adjPrice, atrEntry) => {
    const price = real(adjPrice, i);
    const quantity = Math.floor(o.budget / price);
    if (quantity < 1) return false;
    const cost = round2(quantity * price);
    pos = {
      buyDate: bars[i].date, entryIdx: i, entryAdj: adjPrice, entryPrice: price, quantity, initialQuantity: quantity, cost,
      atrEntry, initialStop: adjPrice - o.stopMult * atrEntry, stop: adjPrice - o.stopMult * atrEntry,
      highestHigh: adjPrice, highestClose: -Infinity, partialDone: false, partialSales: [],
      lots: [{ date: bars[i].date, price, quantity, cost }],
    };
    peakCost = Math.max(peakCost, cost);
    signals.push({ date: bars[i].date, side: 'buy', price });
    return true;
  };

  let pendingAdd = false;
  let adds = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];

    // --- Abertura ---
    if (pos && b.O <= pos.stop) closePos(i, b.O, 'stop');
    if (pos && pendingSell) {
      if (pendingSell.partial) {
        const q = Math.floor(pos.quantity / 2);
        if (q > 0) {
          const price = real(b.O, i);
          pos.partialSales.push({ date: b.date, quantity: q, price, proceeds: round2(q * price) });
          pos.quantity -= q;
          signals.push({ date: b.date, side: 'sell', reason: 'partial_take_profit', price });
        }
        pos.partialDone = true;
        pendingSell = null;
      } else {
        closePos(i, b.O, pendingSell.reason);
      }
    }
    if (pos && pendingAdd) {
      // Reforço (opção addOnGain): mais um orçamento na abertura, sem mexer no stop.
      const price = real(b.O, i);
      const quantity = Math.floor(o.budget / price);
      if (quantity > 0) {
        const cost = round2(quantity * price);
        pos.lots.push({ date: b.date, price, quantity, cost });
        pos.quantity += quantity;
        pos.cost = round2(pos.cost + cost);
        peakCost = Math.max(peakCost, pos.cost);
        adds += 1;
        signals.push({ date: b.date, side: 'add', price });
      }
    }
    pendingAdd = false;
    if (!pos && pendingBuy && !pendingBuy.limit) {
      const pb = pendingBuy;
      pendingBuy = null;
      if (b.O > pb.closeAdj + o.gapProtectAtr * pb.atr) gapCancels += 1;
      else openPos(i, b.O, pb.atr);
    }
    if (!pos && pendingBuy?.limit) {
      const pb = pendingBuy;
      if (b.L <= pb.limit) { pendingBuy = null; openPos(i, Math.min(b.O, pb.limit), pb.atr); }
      else if (i >= pb.validUntil) pendingBuy = null;
    }

    // --- Durante a sessão ---
    if (pos && b.L <= pos.stop) closePos(i, pos.stop, 'stop');

    // --- Fecho ---
    if (pos) {
      pos.highestHigh = Math.max(pos.highestHigh, b.H);
      pos.highestClose = Math.max(pos.highestClose, b.C);
      const ref = o.stopFrom === 'close' ? pos.highestClose : pos.highestHigh;
      if (ind.atr[i] != null) pos.stop = Math.max(pos.stop, ref - o.stopMult * ind.atr[i]);
      if (o.addOnGain > 0 && !pendingSell && (o.maxAdds === 0 || pos.lots.length - 1 < o.maxAdds)
        && b.closeRaw > pos.lots.at(-1).price * (1 + o.addOnGain)) pendingAdd = true;
    }
    if (!review[i] && !(o.entryReview === 'daily' && !pos)) continue;

    const C = b.C;
    const { smaFast, smaSlow, m1, m2, er, vmn, atr } = ind;
    if (pos) {
      // Saídas semanais: o primeiro motivo verificado, por esta ordem; sem decisão se faltar um indicador.
      const need = [vmn[i], smaFast[i], smaSlow[i], m1[i], m2[i]];
      if (need.some((v) => v == null)) continue;
      let reason = null;
      if (vmn[i] < o.minTradedValue) reason = 'liquidity';
      else if (C <= smaSlow[i] || smaFast[i] <= smaSlow[i]) reason = 'trend_break';
      else if (m1[i] <= 0 || m2[i] <= 0) reason = 'momentum_loss';
      else if (o.useTimeStop && i - pos.entryIdx >= o.timeStopSessions && pos.highestClose < pos.entryAdj + o.timeStopAtr * pos.atrEntry) reason = 'time_stop';
      if (reason) pendingSell = { reason };
      else if (o.partialTakeProfit && !pos.partialDone && ind.p90[i] != null && m1[i] > ind.p90[i]) pendingSell = { partial: true };
      continue;
    }
    if (pendingBuy || startIdx < 0 || i < startIdx || i + 1 < o.minHistory) continue;

    // Elegibilidade (conta todos os critérios que falham, para explicar a ausência de compras).
    const fails = [];
    if (vmn[i] == null || vmn[i] < o.minTradedValue) fails.push('liquidity');
    if (smaSlow[i] == null || smaFast[i] == null || !(C > smaSlow[i] && smaFast[i] > smaSlow[i])) fails.push('trend');
    if (m1[i] == null || m2[i] == null || !(m1[i] > 0 && m2[i] > 0)) fails.push('momentum');
    if (o.trendStrength === 'er' && !(er[i] != null && er[i] >= o.erThreshold)) fails.push('trendStrength');
    if (o.trendStrength === 'adx' && !(ind.adx[i] != null && ind.adx[i] >= o.adxThreshold)) fails.push('trendStrength');
    if (lastStopIdx != null && i - lastStopIdx < o.cooldownSessions) fails.push('cooldown');
    if (o.volumeConfirmation && !(ind.cmf[i] != null && ind.cmf[i] > 0)) fails.push('volume');
    if (o.overextensionBlock && !(ind.p90[i] != null && m1[i] != null && m1[i] <= ind.p90[i])) fails.push('overextension');
    if (atr[i] == null) fails.push('trend');
    for (const k of new Set(fails)) blocked[k] += 1;
    if (fails.length) continue;

    pendingBuy = o.pullbackEntry
      ? { reviewIdx: i, atr: atr[i], closeAdj: C, limit: C - o.pullbackAtr * atr[i], validUntil: i + o.pullbackWindow }
      : { reviewIdx: i, atr: atr[i], closeAdj: C };
  }

  const lastIdx = bars.length - 1;
  let open = null;
  if (pos) {
    const lastPrice = bars[lastIdx].closeRaw;
    const partial = pos.partialSales.reduce((s, p) => s + p.proceeds, 0);
    const value = round2(pos.quantity * lastPrice + partial);
    open = {
      buyDate: pos.buyDate, quantity: pos.quantity, cost: pos.cost,
      avgPrice: pos.cost / pos.lots.reduce((q, l) => q + l.quantity, 0), lots: pos.lots,
      reinforcements: pos.lots.length - 1, lastDate: bars[lastIdx].date, lastPrice, value,
      pnl: round2(value - pos.cost), pnlPct: (value / pos.cost - 1) * 100,
      stop: real(pos.stop, lastIdx), initialStop: real(pos.initialStop, pos.entryIdx), partialSales: pos.partialSales,
    };
  }

  // Comparação: o orçamento investido na primeira sessão em que a estratégia pode actuar, mantido até ao fim.
  let buyHold = null;
  if (startIdx >= 0) {
    const p0 = bars[startIdx].closeRaw;
    const qty = Math.floor(o.budget / p0);
    if (qty > 0) {
      const cost = round2(qty * p0);
      const value = round2(qty * bars[lastIdx].closeRaw);
      buyHold = { startDate: bars[startIdx].date, quantity: qty, cost, value, pnl: round2(value - cost), pnlPct: (value / cost - 1) * 100 };
    }
  }

  const realized = round2(trades.reduce((s, t) => s + t.pnl, 0));
  const total = round2(realized + (open?.pnl ?? 0));
  if (open) peakCost = Math.max(peakCost, open.cost);
  return {
    trades, open, signals,
    firstDate: startIdx >= 0 ? bars[startIdx].date : null,
    summary: {
      closed: trades.length,
      wins: trades.filter((t) => t.pnl > 0).length,
      reinforcements: adds,
      peakCost: round2(peakCost),
      realized,
      unrealized: open?.pnl ?? 0,
      total,
      totalPct: peakCost > 0 ? (total / peakCost) * 100 : 0,
      buyHold,
    },
    blocked, gapCancels, exitReasons, dataQuality,
    options: o,
  };
}
