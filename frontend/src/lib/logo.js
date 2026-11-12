/**
 * Logotipos dos instrumentos. As páginas mostram os logotipos internos (base de dados, GET /instruments/{id}/logo). O módulo
 * Administração → Logotipos descarrega no browser, da Brandfetch Logo API, os que faltam e envia-os para o servidor; o pedido
 * à Brandfetch tem de levar a origem (Referer), por isso usa referrerPolicy «strict-origin-when-cross-origin» (a página usa
 * «same-origin», que a omitiria).
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

/** Interruptor global (Definições → Logotipos): ligado por omissão. */
export const logosEnabled = (cfg) => cfg?.enabled !== false;

/** Endereço do logotipo interno; null sem logotipo. */
export const internalLogoUrl = (instrumentId, logoVersion) => (instrumentId && logoVersion ? `/api/v1/instruments/${instrumentId}/logo?v=${logoVersion}` : null);

/** Lado da imagem guardada (px). */
export const LOGO_STORE_SIZE = 128;

/** Encaixa uma imagem w×h num quadrado de side px, sem deformar e centrada: { dx, dy, dw, dh }. */
export function fitSquare(w, h, side = LOGO_STORE_SIZE) {
  const k = side / Math.max(w, h);
  const dw = Math.round(w * k);
  const dh = Math.round(h * k);
  return { dx: Math.round((side - dw) / 2), dy: Math.round((side - dh) / 2), dw, dh };
}
