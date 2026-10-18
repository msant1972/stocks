/**
 * Indicador de momento «myforce» (equivalente ao script Pine fornecido pelo utilizador):
 *   wave     = SMA10 / SMA200 − 1   (área; verde quando sobe face às duas sessões anteriores)
 *   wave125  = SMA8  / SMA125 − 1   (linha)
 * Em percentagem. SMA10, SMA125 e SMA200 vêm da BD (fecho ajustado); a SMA8 é calculada aqui.
 */

const n = (v) => (v == null ? null : Number(v));

/** Média móvel simples sobre números; null nas primeiras period-1 posições. */
export function rollingMean(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

const ratioPct = (a, b) => (a == null || b == null || b === 0 ? null : (a / b - 1) * 100);

/** Devolve, por sessão, { wave, wave125, rising } alinhado com quotes (ordem cronológica). */
export function momentum(quotes) {
  const prices = quotes.map((q) => Number(q.adjClose ?? q.close));
  const sma8 = rollingMean(prices, 8);
  const wave = quotes.map((q) => ratioPct(n(q.sma10), n(q.sma200)));
  return quotes.map((q, i) => ({
    wave: wave[i],
    wave125: ratioPct(sma8[i], n(q.sma125)),
    // ta.rising(wave, 2): o valor actual é maior do que cada um dos dois anteriores.
    rising: i >= 2 && wave[i] != null && wave[i - 1] != null && wave[i - 2] != null
      && wave[i] > wave[i - 1] && wave[i] > wave[i - 2],
  }));
}

/** Marcas «redondas» para o eixo do momento, sempre com o 0 incluído (passo 1, 2, 5, 10, 20…). */
export function niceTicks(values, target = 4) {
  const finite = values.filter((v) => v != null && Number.isFinite(v));
  const lo = Math.min(0, ...finite);
  const hi = Math.max(0, ...finite);
  const raw = (hi - lo) / target || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let t = Math.floor(lo / step) * step; t <= Math.ceil(hi / step) * step + step / 2; t += step) {
    ticks.push(Math.round(t * 1e6) / 1e6);
  }
  return ticks;
}
