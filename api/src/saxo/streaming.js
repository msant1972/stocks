import { randomBytes } from 'node:crypto';
import { openSession } from './service.js';

/**
 * Mensagens do streaming da SAXO (formato binário): por mensagem, 8 bytes do id (int64 LE), 2 reservados, 1 byte com o
 * tamanho do ReferenceId, o ReferenceId (ASCII), 1 byte de formato (0 = JSON) e 4 bytes do tamanho (int32 LE) do conteúdo.
 */
export function parseFrames(data) {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const out = [];
  let i = 0;
  while (i + 16 <= b.length) {
    const messageId = b.readBigInt64LE(i);
    i += 10;
    const refLen = b[i];
    i += 1;
    const referenceId = b.toString('ascii', i, i + refLen);
    i += refLen;
    const format = b[i];
    i += 1;
    const size = b.readInt32LE(i);
    i += 4;
    const raw = b.subarray(i, i + size);
    i += size;
    let payload = null;
    if (format === 0) {
      try { payload = JSON.parse(raw.toString('utf8')); } catch { /* conteúdo inválido: ignora */ }
    }
    out.push({ messageId: String(messageId), referenceId, format, payload });
  }
  return out;
}

/** Monta uma mensagem no formato da SAXO (usado nos testes). */
export function buildFrame(referenceId, payload, messageId = 1n) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const ref = Buffer.from(referenceId, 'ascii');
  const head = Buffer.alloc(10);
  head.writeBigInt64LE(BigInt(messageId));
  const size = Buffer.alloc(4);
  size.writeInt32LE(body.length);
  return Buffer.concat([head, Buffer.from([ref.length]), ref, Buffer.from([0]), size, body]);
}

const REF = 'orders';

/**
 * Ligações de streaming às ordens da SAXO, uma por utilizador com ordens abertas e ligação OAuth válida. Cada mensagem
 * sobre ordens (ou um pedido de reposição) chama `onOrdersChanged(userId)` (com 1 s de espera, para juntar rajadas).
 * `sync()` é chamado pela vigia: liga quem precisa, desliga quem já não tem ordens abertas e volta a ligar quando o token
 * é renovado (o WebSocket autentica-se no endereço). A vigia de 60 s continua como reserva.
 */
export function createStreamManager({ pool, cfg, log = null, onOrdersChanged, WebSocketImpl = globalThis.WebSocket, debounceMs = 1000 }) {
  const conns = new Map(); // userId -> { ws, contextId, tokenAt, session, timer }

  const close = async (userId) => {
    const c = conns.get(userId);
    if (!c) return;
    conns.delete(userId);
    clearTimeout(c.timer);
    try { c.ws.close(); } catch { /* já fechado */ }
    c.session?.client.del(`/port/v1/orders/subscriptions/${c.contextId}`).catch(() => {});
  };

  const changed = (userId) => {
    const c = conns.get(userId);
    if (!c) return;
    clearTimeout(c.timer);
    c.timer = setTimeout(() => {
      Promise.resolve(onOrdersChanged(userId)).catch((err) => log?.warn?.({ userId, err: err.message }, 'saxo: streaming: actualização falhou'));
    }, debounceMs);
    c.timer.unref?.();
  };

  async function connect(userId, tokenAt) {
    const session = await openSession(pool, cfg, userId);
    const contextId = `stocks${userId}${randomBytes(6).toString('hex')}`;
    const url = `${cfg.saxo.streamUrl}?contextId=${contextId}&authorization=${encodeURIComponent(`BEARER ${session.token}`)}`;
    const ws = new WebSocketImpl(url);
    ws.binaryType = 'arraybuffer';
    const c = { ws, contextId, tokenAt, session, timer: null };
    conns.set(userId, c);
    ws.onmessage = (ev) => {
      for (const m of parseFrames(Buffer.from(ev.data))) {
        if (m.referenceId === REF) changed(userId);
        else if (m.referenceId === '_resetsubscriptions' || m.referenceId === '_disconnect') close(userId); // a próxima sincronização volta a ligar
      }
    };
    ws.onclose = () => { if (conns.get(userId) === c) conns.delete(userId); };
    ws.onerror = () => { if (conns.get(userId) === c) close(userId); };
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('o streaming não abriu')), 10_000);
      ws.onopen = () => { clearTimeout(t); resolve(); };
    });
    const me = await session.client.get('/port/v1/users/me');
    await session.client.post('/port/v1/orders/subscriptions', { ContextId: contextId, ReferenceId: REF, Arguments: { ClientKey: me?.ClientKey } });
    log?.debug?.({ userId }, 'saxo: streaming ligado');
  }

  async function sync() {
    if (!cfg.saxo.streaming || !WebSocketImpl) return;
    const [rows] = await pool.query(
      `SELECT t.user_id, t.updated_at FROM user_integration_tokens t
        WHERE t.provider = 'saxo' AND t.rejected_at IS NULL AND (t.environment = 'sim' OR ?)
          AND EXISTS (SELECT 1 FROM saxo_orders o WHERE o.user_id = t.user_id AND o.status = 'working')`,
      [cfg.saxo.allowLive],
    );
    const want = new Map(rows.map((r) => [Number(r.user_id), r.updated_at.getTime()]));
    for (const userId of [...conns.keys()]) {
      if (!want.has(userId) || conns.get(userId).tokenAt !== want.get(userId)) await close(userId);
    }
    for (const [userId, tokenAt] of want) {
      if (conns.has(userId)) continue;
      try {
        await connect(userId, tokenAt);
      } catch (err) {
        await close(userId);
        log?.warn?.({ userId, code: err.code, err: err.message }, 'saxo: streaming não ligou');
      }
    }
  }

  return { sync, close, closeAll: async () => { for (const id of [...conns.keys()]) await close(id); }, connections: () => conns.size };
}
