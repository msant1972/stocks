/** Fotografia do utilizador: endereço da imagem e redução no browser antes de enviar. */
export const PHOTO_SIZE = 256;

/** Endereço da fotografia (a versão no endereço faz o browser pedi-la de novo quando muda); null sem fotografia. */
export function photoUrl(user) {
  return user?.photoVersion ? `/api/v1/users/${user.id}/photo?v=${user.photoVersion}` : null;
}

/** Iniciais do nome (até duas letras) para quando não há fotografia. */
export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts.at(-1)[0] : '';
  return (first + last).toLocaleUpperCase('pt-PT');
}

/** Recorte quadrado ao centro: { sx, sy, side } da imagem de largura w e altura h. */
export function squareCrop(w, h) {
  const side = Math.min(w, h);
  return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) / 2), side };
}

/** Reduz a imagem para um quadrado de PHOTO_SIZE px em JPEG (tira também os metadados, como a localização). */
export async function resizePhoto(file, size = PHOTO_SIZE) {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um ficheiro de imagem.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('Não foi possível ler esta imagem.'); }
  const { sx, sy, side } = squareCrop(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Não foi possível preparar a imagem.');
  return blob;
}
