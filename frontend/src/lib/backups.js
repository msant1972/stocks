/** Funções puras das cópias de segurança (Definições). */

/** Tamanho em bytes, para pessoas: «850 KB», «9,3 MB», «1,2 GB» (base 1024, vírgula decimal). */
export function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes))) return '—';
  const b = Number(bytes);
  const n = (x, d) => x.toLocaleString('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (b >= 1024 ** 3) return `${n(b / 1024 ** 3, 1)} GB`;
  if (b >= 1024 ** 2) return `${n(b / 1024 ** 2, 1)} MB`;
  if (b >= 1024) return `${n(b / 1024, 0)} KB`;
  return `${n(b, 0)} B`;
}

/** Idade da cópia mais recente em horas inteiras (agora − data), ou null sem cópias. */
export function newestAgeHours(items, now = Date.now()) {
  if (!items.length) return null;
  return Math.floor((now - Date.parse(items[0].createdAt)) / 3_600_000);
}

/** Aviso sobre a frescura das cópias: a diária corre às 03:30 UTC, por isso mais de 30 h sem nova cópia é anormal. */
export function staleBackupWarning(items, now = Date.now()) {
  const h = newestAgeHours(items, now);
  if (h == null) return 'Ainda não há nenhuma cópia de segurança.';
  return h > 30 ? `A cópia mais recente tem ${h} horas: a cópia diária (03:30 UTC) pode ter falhado.` : null;
}
