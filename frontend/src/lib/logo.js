/**
 * Logotipos dos instrumentos (Brandfetch Logo API). As imagens vêm directamente do CDN da Brandfetch, como as regras dela
 * exigem (sem cópias nem pedidos programáticos); o pedido tem de levar a origem (Referer), por isso a imagem usa
 * referrerPolicy «strict-origin-when-cross-origin» (a página usa «same-origin», que a omitiria).
 */
export const LOGO_CDN = 'https://cdn.brandfetch.io';

/** Domínio do site da empresa («https://www.asml.com/en» → «asml.com»); null se não for um domínio válido. */
export function domainOf(website) {
  if (!website) return null;
  let host;
  try { host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname; } catch { return null; }
  host = host.toLowerCase().replace(/^www\d?\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** Endereço do ícone quadrado (size px, o dobro para ecrãs de alta densidade); 404 quando a Brandfetch não o tem. */
export function logoUrl(domain, clientId, size = 64) {
  if (!domain || !clientId) return null;
  const px = Math.min(2048, Math.max(16, Math.round(size * 2)));
  return `${LOGO_CDN}/domain/${encodeURIComponent(domain)}/w/${px}/h/${px}/fallback/404/type/icon?c=${encodeURIComponent(clientId)}`;
}

/** Client ID a usar: null quando os logotipos estão desligados (interruptor global) ou sem configuração. */
export const activeClientId = (cfg) => (cfg?.enabled === false ? null : cfg?.clientId ?? null);
