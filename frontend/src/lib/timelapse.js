/** Timelapse: posições de cada instrumento numa sessão e a variação face à sessão anterior. */

/**
 * Linhas a desenhar numa sessão: todos os instrumentos que aparecem em alguma sessão (para as barras entrarem e saírem
 * com animação). Os que não estão no top desta sessão ficam com rank null (fora do gráfico).
 * Devolve [{ id, rank (0 = 1.º) | null, value, delta (posições ganhas; null se entrou agora), isNew }].
 */
export function frameRows(frames, index, allIds) {
  const cur = frames[index];
  const prev = index > 0 ? frames[index - 1] : null;
  const rankIn = (f) => new Map((f?.items ?? []).map((it, i) => [it.id, i]));
  const now = rankIn(cur);
  const before = rankIn(prev);
  const value = new Map((cur?.items ?? []).map((it) => [it.id, it.value]));
  return allIds.map((id) => {
    const rank = now.get(id) ?? null;
    const was = before.get(id);
    return {
      id, rank, value: value.get(id) ?? 0,
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
