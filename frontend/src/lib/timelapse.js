/** Timelapse: posições de cada instrumento numa sessão e a variação face à sessão anterior. */

/**
 * Linhas a desenhar numa sessão: todos os instrumentos que aparecem em alguma sessão (para as barras entrarem e saírem
 * com animação). Os que não estão no top desta sessão ficam com rank null (fora do gráfico).
 * Devolve [{ id, rank (0 = 1.º) | null, value, change (variação do preço), delta (posições ganhas; null se entrou agora), isNew }].
 */
export function frameRows(frames, index, allIds) {
  const cur = frames[index];
  const prev = index > 0 ? frames[index - 1] : null;
  const rankIn = (f) => new Map((f?.items ?? []).map((it, i) => [it.id, i]));
  const now = rankIn(cur);
  const before = rankIn(prev);
  const value = new Map((cur?.items ?? []).map((it) => [it.id, it.value]));
  const change = new Map((cur?.items ?? []).map((it) => [it.id, it.change ?? null]));
  return allIds.map((id) => {
    const rank = now.get(id) ?? null;
    const was = before.get(id);
    return {
      id, rank, value: value.get(id) ?? 0, change: change.get(id) ?? null,
      delta: rank == null || was == null ? null : was - rank,
      isNew: Boolean(prev) && rank != null && was == null,
    };
  });
}

/** Instrumentos que aparecem em alguma sessão, pela ordem da primeira aparição. */
export function allFrameIds(frames = []) {
  const seen = new Set();
  for (const f of frames) for (const it of f.items) seen.add(it.id);
  return [...seen];
}

/** Texto da variação de posição: «▲ 3», «▼ 1», «novo» ou «=». */
export function deltaLabel(row) {
  if (row.isNew) return 'novo';
  if (row.delta == null) return '';
  if (row.delta > 0) return `▲ ${row.delta}`;
  if (row.delta < 0) return `▼ ${-row.delta}`;
  return '=';
}

/** Quem mais subiu e quem mais desceu entre a primeira e a última sessão (só os que estão no top nas duas). */
export function biggestMoves(frames = []) {
  if (frames.length < 2) return { up: null, down: null };
  const first = new Map(frames[0].items.map((it, i) => [it.id, i]));
  let up = null;
  let down = null;
  frames.at(-1).items.forEach((it, i) => {
    if (!first.has(it.id)) return;
    const d = first.get(it.id) - i;
    if (d > 0 && (!up || d > up.delta)) up = { id: it.id, delta: d };
    if (d < 0 && (!down || d < down.delta)) down = { id: it.id, delta: d };
  });
  return { up, down };
}

/**
 * Faixa «quase não mexeu» da variação do preço, por número de sessões somadas: mexer 2 % numa sessão é muito, em 10 é
 * pouco. Fora dela, 3 intensidades: até 2×, até 4× e acima.
 */
export const FLAT_BAND = { 1: 0.01, 5: 0.02, 10: 0.03, 20: 0.04 };

/** Tom da barra pela variação do preço: 'up-1..3', 'down-1..3', 'flat', ou null sem variação conhecida. */
export function changeTone(change, window = 5) {
  if (change == null || !Number.isFinite(change)) return null;
  const b = FLAT_BAND[window] ?? 0.02;
  const a = Math.abs(change);
  if (a < b) return 'flat';
  const level = a < 2 * b ? 1 : a < 4 * b ? 2 : 3;
  return `${change > 0 ? 'up' : 'down'}-${level}`;
}

/** Legenda dos tons, da maior descida à maior subida, com os limites em % para estas sessões. */
export function toneLegend(window = 5) {
  const b = (FLAT_BAND[window] ?? 0.02) * 100;
  const n = (x) => x.toLocaleString('pt-PT', { maximumFractionDigits: 1 });
  return [
    { tone: 'down-3', label: `≤ −${n(4 * b)} %` },
    { tone: 'down-2', label: `−${n(4 * b)} a −${n(2 * b)} %` },
    { tone: 'down-1', label: `−${n(2 * b)} a −${n(b)} %` },
    { tone: 'flat', label: `±${n(b)} %` },
    { tone: 'up-1', label: `+${n(b)} a +${n(2 * b)} %` },
    { tone: 'up-2', label: `+${n(2 * b)} a +${n(4 * b)} %` },
    { tone: 'up-3', label: `≥ +${n(4 * b)} %` },
  ];
}

/** Variação do preço em texto: «+2,1 %», «−0,4 %», ou «» sem valor. */
export function changeText(change) {
  if (change == null || !Number.isFinite(change)) return '';
  const v = Math.round(change * 1000) / 10; // arredondar antes do sinal: −0,04 % mostra-se «0,0 %»
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}
