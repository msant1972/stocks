/** Funções puras da ligação à SAXO Bank (conta de simulação). */

export const ORDER_STATUS = {
  sending: 'A enviar',
  working: 'Aberta',
  ended: 'Já não está aberta',
  cancelled: 'Cancelada',
  rejected: 'Recusada',
  unknown: 'Por confirmar',
};

export const ORDER_STATUS_HELP = {
  ended: 'Já não consta das ordens abertas da SAXO: foi executada, expirou ou foi cancelada fora da aplicação. Confirme na plataforma da SAXO.',
  unknown: 'A SAXO não respondeu ao envio. Confirme na plataforma da SAXO se a ordem foi aceite antes de a repetir.',
};

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
