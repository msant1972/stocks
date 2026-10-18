/** Cliente da API. O cookie de sessão é enviado automaticamente (mesma origem). */

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api/v1${path}`, init);
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem ligação ao servidor. Verifique a ligação e tente de novo.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'HTTP_ERROR', e.message ?? `Erro ${res.status}`, e.details);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};

/** Mensagem legível para o utilizador, com a primeira letra em maiúscula. */
export function errorMessage(err) {
  const msg = err?.message || 'Ocorreu um erro inesperado.';
  return msg.charAt(0).toUpperCase() + msg.slice(1);
}

/** Chave de idempotência para operações simuladas. */
export function newIdempotencyKey() {
  return crypto.randomUUID().replaceAll('-', '');
}
