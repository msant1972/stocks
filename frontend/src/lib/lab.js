/** Laboratório: estados das experiências e filtros (funções puras, testadas com node --test). */
export const LAB_STATUS = {
  running: { label: 'A decorrer', tone: 'badge-accent' },
  idea: { label: 'Ideia', tone: '' },
  kept: { label: 'Mantida', tone: 'badge-positive' },
  dropped: { label: 'Abandonada', tone: 'badge-negative' },
};
export const LAB_ORDER = ['running', 'idea', 'kept', 'dropped'];

/** Contagem por estado. */
export function countByStatus(items) {
  const out = Object.fromEntries(LAB_ORDER.map((k) => [k, 0]));
  for (const it of items) out[it.status] = (out[it.status] ?? 0) + 1;
  return out;
}

/** Filtra por estado ('all' = todos) e por texto no título, hipótese ou resultado (sem acentos nem maiúsculas). */
export function filterExperiments(items, { status = 'all', q = '' } = {}) {
  const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const needle = fold(q.trim());
  return items.filter((it) => (status === 'all' || it.status === status)
    && (!needle || [it.title, it.hypothesis, it.metric, it.result].some((t) => fold(t).includes(needle))));
}

/** Corpo do pedido a partir do formulário: textos vazios → null; datas vazias → null. */
export function experimentPayload(form) {
  const t = (v) => (v && v.trim() ? v.trim() : null);
  return {
    title: form.title.trim(), status: form.status, hypothesis: t(form.hypothesis), metric: t(form.metric), result: t(form.result),
    startedOn: form.startedOn || null, decidedOn: form.decidedOn || null,
  };
}
