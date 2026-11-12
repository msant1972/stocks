import { fitSquare, LOGO_STORE_SIZE, logoUrl } from './logo.js';

/**
 * Descarrega no browser o ícone de um domínio da Brandfetch e devolve-o em PNG de 128 px (transparência mantida).
 * Usa uma imagem com crossOrigin (o CDN da Brandfetch responde com CORS aberto) e a origem no Referer, como a Brandfetch
 * exige; o servidor nunca contacta a Brandfetch. Erro «NOT_FOUND» quando a Brandfetch não tem logotipo (ou a imagem falha).
 */
export async function downloadLogo(domain, clientId, { timeoutMs = 15000 } = {}) {
  const url = logoUrl(domain, clientId, LOGO_STORE_SIZE / 2); // logoUrl pede o dobro: 128 px
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.referrerPolicy = 'strict-origin-when-cross-origin';
  img.decoding = 'async';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('tempo esgotado'), { code: 'TIMEOUT' })), timeoutMs);
    img.onload = () => { clearTimeout(t); resolve(); };
    img.onerror = () => { clearTimeout(t); reject(Object.assign(new Error('sem logotipo na Brandfetch'), { code: 'NOT_FOUND' })); };
    img.src = url;
  });
  if (!img.naturalWidth || !img.naturalHeight) throw Object.assign(new Error('imagem vazia'), { code: 'NOT_FOUND' });
  const canvas = document.createElement('canvas');
  canvas.width = LOGO_STORE_SIZE;
  canvas.height = LOGO_STORE_SIZE;
  const { dx, dy, dw, dh } = fitSquare(img.naturalWidth, img.naturalHeight);
  canvas.getContext('2d').drawImage(img, dx, dy, dw, dh);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('não foi possível converter a imagem');
  return blob;
}
