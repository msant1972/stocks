import mysql from 'mysql2/promise';

/**
 * DECIMAL chega como string (sem perda de precisão) e DATE como 'AAAA-MM-DD'.
 * A sessão usa UTC, por isso os TIMESTAMP chegam como Date em UTC.
 */
export function createPool(db) {
  const pool = mysql.createPool({
    ...db,
    connectionLimit: 10,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: ['DATE'],
    decimalNumbers: false,
    supportBigNumbers: true,
  });
  pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));
  return pool;
}

export async function withTransaction(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Regista uma acção relevante. detail nunca deve conter palavras-passe, tokens ou credenciais. */
export async function audit(conn, userId, action, entity = null, entityId = null, detail = null) {
  await conn.query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
    [userId, action, entity, entityId, detail == null ? null : JSON.stringify(detail)],
  );
}
