"""Acesso à base de dados MariaDB do motor de recolha."""
from datetime import date

import pymysql
import pymysql.cursors

from .config import Settings
from .models import DailyQuote, InstrumentInfo

# Um pedido em 'running' há mais do que isto é considerado abandonado (processo terminado a meio).
STALE_RUNNING_MINUTES = 30


def connect(settings: Settings):
    return pymysql.connect(
        host=settings.db_host,
        port=settings.db_port,
        user=settings.db_user,
        password=settings.db_password,
        database=settings.db_name,
        autocommit=False,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def add_instrument(conn, symbol: str) -> tuple[int, bool]:
    """Regista o símbolo no catálogo e pede a carga inicial. Devolve (id, criado)."""
    with conn.cursor() as cur:
        cur.execute("INSERT IGNORE INTO instruments (symbol) VALUES (%s)", (symbol,))
        created = cur.rowcount == 1
        cur.execute("SELECT id FROM instruments WHERE symbol = %s", (symbol,))
        instrument_id = cur.fetchone()["id"]
        if created:
            cur.execute(
                "INSERT INTO fetch_jobs (instrument_id, kind) VALUES (%s, 'initial')",
                (instrument_id,),
            )
    conn.commit()
    return instrument_id, created


def requeue_stale_jobs(conn) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE fetch_jobs SET status = 'queued', last_error = 'reposto: execução anterior interrompida' "
            "WHERE status = 'running' AND started_at < NOW(3) - INTERVAL %s MINUTE",
            (STALE_RUNNING_MINUTES,),
        )
        n = cur.rowcount
    conn.commit()
    return n


def claim_job(conn) -> dict | None:
    """Reserva atomicamente o próximo pedido elegível.

    SKIP LOCKED permite vários processos em paralelo sem reservarem o mesmo pedido; a condição
    NOT EXISTS impede duas recolhas simultâneas do mesmo instrumento.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT j.id, j.instrument_id, j.kind, j.attempts, i.symbol, i.status AS instrument_status,
                   i.last_session
              FROM fetch_jobs j
              JOIN instruments i ON i.id = j.instrument_id
             WHERE j.status = 'queued'
               AND j.next_attempt_at <= NOW(3)
               AND NOT EXISTS (SELECT 1 FROM fetch_jobs r
                                WHERE r.instrument_id = j.instrument_id AND r.status = 'running')
             ORDER BY j.id
             LIMIT 1
               FOR UPDATE SKIP LOCKED
            """
        )
        job = cur.fetchone()
        if job is None:
            conn.rollback()
            return None
        cur.execute(
            "UPDATE fetch_jobs SET status = 'running', attempts = attempts + 1, started_at = NOW(3) "
            "WHERE id = %s",
            (job["id"],),
        )
        job["attempts"] += 1
    conn.commit()
    return job


def upsert_quotes(cur, instrument_id: int, quotes: list[DailyQuote], source: str) -> int:
    """Insere ou actualiza sessões; repetir a recolha nunca duplica linhas."""
    if not quotes:
        return 0
    cur.executemany(
        """
        INSERT INTO daily_quotes
          (instrument_id, session_date, open, high, low, close, adj_close, volume, source)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
          open = VALUES(open), high = VALUES(high), low = VALUES(low), close = VALUES(close),
          adj_close = VALUES(adj_close), volume = VALUES(volume), source = VALUES(source)
        """,
        [
            (instrument_id, q.session_date, q.open, q.high, q.low, q.close, q.adj_close, q.volume, source)
            for q in quotes
        ],
    )
    return len(quotes)


def complete_job(conn, job_id: int, instrument_id: int, info: InstrumentInfo | None,
                 quotes: list[DailyQuote], source: str, note: str | None) -> int:
    """Grava cotações, cobertura do instrumento e fim do pedido numa só transacção."""
    try:
        with conn.cursor() as cur:
            written = upsert_quotes(cur, instrument_id, quotes, source)
            if info is not None:
                cur.execute(
                    "UPDATE instruments SET status = 'active', status_reason = NULL, "
                    "currency = %s, exchange = %s, name = %s WHERE id = %s",
                    (info.currency, info.exchange, info.name, instrument_id),
                )
            cur.execute(
                "UPDATE instruments i SET "
                "first_session = (SELECT MIN(session_date) FROM daily_quotes WHERE instrument_id = i.id), "
                "last_session  = (SELECT MAX(session_date) FROM daily_quotes WHERE instrument_id = i.id) "
                "WHERE i.id = %s",
                (instrument_id,),
            )
            cur.execute(
                "UPDATE fetch_jobs SET status = 'done', finished_at = NOW(3), rows_written = %s, "
                "last_error = %s WHERE id = %s",
                (written, note, job_id),
            )
        conn.commit()
        return written
    except Exception:
        conn.rollback()
        raise


def fail_job(conn, job_id: int, error: str, retry_in_minutes: int | None,
             invalidate_instrument_id: int | None = None) -> None:
    """Marca o pedido como falhado, ou volta a pô-lo na fila se retry_in_minutes for dado."""
    with conn.cursor() as cur:
        if retry_in_minutes is None:
            cur.execute(
                "UPDATE fetch_jobs SET status = 'failed', finished_at = NOW(3), last_error = %s WHERE id = %s",
                (error[:2000], job_id),
            )
        else:
            cur.execute(
                "UPDATE fetch_jobs SET status = 'queued', last_error = %s, "
                "next_attempt_at = NOW(3) + INTERVAL %s MINUTE WHERE id = %s",
                (error[:2000], retry_in_minutes, job_id),
            )
        if invalidate_instrument_id is not None:
            cur.execute(
                "UPDATE instruments SET status = 'invalid', status_reason = %s WHERE id = %s",
                (error[:255], invalidate_instrument_id),
            )
    conn.commit()


def enqueue_incremental(conn) -> int:
    """Pede actualização de todos os instrumentos activos que ainda não têm um pedido pendente."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO fetch_jobs (instrument_id, kind)
            SELECT i.id, 'incremental' FROM instruments i
             WHERE i.status = 'active'
               AND NOT EXISTS (SELECT 1 FROM fetch_jobs j
                                WHERE j.instrument_id = i.id AND j.status IN ('queued','running'))
            """
        )
        n = cur.rowcount
    conn.commit()
    return n


def instrument_overview(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT i.symbol, i.status, i.status_reason, i.currency, i.name, i.first_session, i.last_session,
                   (SELECT COUNT(*) FROM daily_quotes q WHERE q.instrument_id = i.id) AS sessions,
                   (SELECT j.last_error FROM fetch_jobs j WHERE j.instrument_id = i.id
                     ORDER BY j.id DESC LIMIT 1) AS last_error
              FROM instruments i ORDER BY i.symbol
            """
        )
        rows = cur.fetchall()
    conn.commit()
    return rows


def history_start(today: date, years: int) -> date:
    try:
        return today.replace(year=today.year - years)
    except ValueError:  # 29 de Fevereiro
        return today.replace(year=today.year - years, day=28)
