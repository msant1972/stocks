"""Acesso à base de dados MariaDB do motor de recolha."""
import json
from datetime import date

import pymysql
import pymysql.cursors

from . import indicators
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


def upsert_quotes(cur, instrument_id: int, quotes: list[DailyQuote], source: str,
                  provisional: date | None = None) -> int:
    """Insere ou actualiza sessões; repetir a recolha nunca duplica linhas.

    provisional: sessão cuja vela ainda não é definitiva (a do próprio dia, durante a sessão).
    """
    if not quotes:
        return 0
    cur.executemany(
        """
        INSERT INTO daily_quotes
          (instrument_id, session_date, open, high, low, close, adj_close, volume, provisional, source)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
          open = VALUES(open), high = VALUES(high), low = VALUES(low), close = VALUES(close),
          adj_close = VALUES(adj_close), volume = VALUES(volume), provisional = VALUES(provisional),
          source = VALUES(source)
        """,
        [
            (instrument_id, q.session_date, q.open, q.high, q.low, q.close, q.adj_close, q.volume,
             q.session_date == provisional, source)
            for q in quotes
        ],
    )
    return len(quotes)


def update_indicators(cur, instrument_id: int) -> int:
    """Recalcula os indicadores de todas as sessões do instrumento sobre o fecho ajustado.

    A série é sempre calculada por inteiro (um ajuste do fornecedor a dividendos altera os fechos do passado),
    mas só se gravam as sessões cujos valores mudaram: numa recolha normal são as poucas sessões relidas.
    Devolve o número de sessões actualizadas.
    """
    cols = ", ".join(indicators.COLUMNS)
    cur.execute(
        f"SELECT session_date, COALESCE(adj_close, close) AS price, {cols} FROM daily_quotes "
        "WHERE instrument_id = %s ORDER BY session_date",
        (instrument_id,),
    )
    rows = cur.fetchall()
    if not rows:
        return 0
    values = indicators.compute([r["price"] for r in rows])
    changed = [(v, r) for v, r in zip(values, rows, strict=True) if v != tuple(r[c] for c in indicators.COLUMNS)]
    if changed:
        sets = ", ".join(f"{c} = %s" for c in indicators.COLUMNS)
        cur.executemany(
            f"UPDATE daily_quotes SET {sets}, fetched_at = fetched_at WHERE instrument_id = %s AND session_date = %s",
            [(*v, instrument_id, r["session_date"]) for v, r in changed],
        )
    return len(changed)


def recompute_all_indicators(conn) -> int:
    """Recalcula os indicadores de todos os instrumentos activos (um por transacção)."""
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM instruments WHERE status = 'active' ORDER BY id")
        ids = [r["id"] for r in cur.fetchall()]
    conn.commit()
    for instrument_id in ids:
        with conn.cursor() as cur:
            update_indicators(cur, instrument_id)
        conn.commit()
    return len(ids)


def fill_isin_mic(cur, instrument_id: int) -> str | None:
    """Preenche o ISIN-MIC do instrumento a partir da lista oficial da Euronext (tabela euronext_isins), se
    ainda não o tiver e o símbolo Yahoo constar da lista. Devolve o ISIN-MIC preenchido, ou None.
    A mesma regra é aplicada a todo o catálogo por scripts/isin-mic-from-xlsx.mjs."""
    cur.execute(
        "SELECT i.symbol, e.isin, e.mic FROM instruments i JOIN euronext_isins e ON e.yahoo_symbol = i.symbol "
        "WHERE i.id = %s AND (i.isin IS NULL OR i.mic IS NULL)",
        (instrument_id,),
    )
    row = cur.fetchone()
    if row is None:
        return None
    isin_mic = f"{row['isin']}-{row['mic']}"
    cur.execute("UPDATE instruments SET isin = %s, mic = %s WHERE id = %s", (row["isin"], row["mic"], instrument_id))
    cur.execute(
        "INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (NULL, 'instrument.isin_mic', 'instrument', %s, %s)",
        (instrument_id, json.dumps({"symbol": row["symbol"], "isinMic": isin_mic, "source": "euronext_isins"})),
    )
    return isin_mic


def complete_job(conn, job_id: int, instrument_id: int, info: InstrumentInfo | None,
                 quotes: list[DailyQuote], source: str, note: str | None, provisional: date | None = None) -> int:
    """Grava cotações, cobertura do instrumento e fim do pedido numa só transacção."""
    try:
        with conn.cursor() as cur:
            written = upsert_quotes(cur, instrument_id, quotes, source, provisional)
            if written:
                update_indicators(cur, instrument_id)
            if info is not None:
                cur.execute(
                    "UPDATE instruments SET status = 'active', status_reason = NULL, "
                    "currency = %s, exchange = %s, name = %s WHERE id = %s",
                    (info.currency, info.exchange, info.name, instrument_id),
                )
                # Instrumento novo, agora validado: ISIN-MIC da lista oficial da Euronext, se constar.
                fill_isin_mic(cur, instrument_id)
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


def enqueue_backfill(conn, start: date) -> int:
    """Pede de novo a carga inicial dos instrumentos activos cujo histórico começa depois de start
    (ex.: depois de aumentar STOCKS_HISTORY_YEARS). As sessões existentes são actualizadas, não duplicadas."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO fetch_jobs (instrument_id, kind)
            SELECT i.id, 'initial' FROM instruments i
             WHERE i.status = 'active' AND (i.first_session IS NULL OR i.first_session > %s)
               AND NOT EXISTS (SELECT 1 FROM fetch_jobs j
                                WHERE j.instrument_id = i.id AND j.status IN ('queued','running'))
            """,
            (start,),
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


def start_run(conn, kind: str) -> int:
    """Regista o início de uma execução agendada (consultada pela API em /status)."""
    with conn.cursor() as cur:
        cur.execute("INSERT INTO job_runs (kind) VALUES (%s)", (kind,))
        run_id = cur.lastrowid
    conn.commit()
    return run_id


def finish_run(conn, run_id: int, ok: bool, detail: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE job_runs SET status = %s, detail = %s, finished_at = NOW(3) WHERE id = %s",
            ("done" if ok else "failed", detail[:4000], run_id),
        )
    conn.commit()


def failed_jobs_since(conn, run_started_id: int) -> int:
    """Pedidos incrementais que falharam definitivamente desde o início da execução."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) AS n FROM fetch_jobs WHERE status = 'failed' AND kind = 'incremental' "
            "AND finished_at >= (SELECT started_at FROM job_runs WHERE id = %s)",
            (run_started_id,),
        )
        n = cur.fetchone()["n"]
    conn.commit()
    return n


def history_start(today: date, years: int) -> date:
    try:
        return today.replace(year=today.year - years)
    except ValueError:  # 29 de Fevereiro
        return today.replace(year=today.year - years, day=28)


# --- Perfis das empresas ---

PROFILE_FIELDS = [
    "long_name", "summary", "sector", "industry", "country", "city", "website", "employees", "currency", "financial_currency",
    "market_cap", "trailing_pe", "forward_pe", "price_to_book", "dividend_yield", "beta", "eps", "profit_margin",
    "return_on_equity", "debt_to_equity", "high_52w", "low_52w",
]


def instruments_needing_profiles(conn, stale_days: int, limit: int | None = None) -> list[dict]:
    """Instrumentos activos sem perfil, ou com o perfil recolhido há mais de stale_days dias (os mais antigos primeiro)."""
    sql = ("SELECT i.id, i.symbol FROM instruments i LEFT JOIN company_profiles p ON p.instrument_id = i.id "
           "WHERE i.status = 'active' AND (p.fetched_at IS NULL OR p.fetched_at < NOW(3) - INTERVAL %s DAY) "
           "ORDER BY p.fetched_at IS NOT NULL, p.fetched_at, i.id")
    args: tuple = (stale_days,)
    if limit:
        sql += " LIMIT %s"
        args += (limit,)
    with conn.cursor() as cur:
        cur.execute(sql, args)
        rows = cur.fetchall()
    conn.commit()
    return rows


def save_profile(conn, instrument_id: int, profile) -> None:
    """Grava o perfil (ou marca-o como inexistente no fornecedor, se vier vazio)."""
    status = "missing" if profile.is_empty() else "ok"
    values = [getattr(profile, f) for f in PROFILE_FIELDS]
    cols = ", ".join(PROFILE_FIELDS)
    marks = ", ".join(["%s"] * len(PROFILE_FIELDS))
    updates = ", ".join(f"{f} = VALUES({f})" for f in PROFILE_FIELDS)
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO company_profiles (instrument_id, status, {cols}, financials, error, fetched_at) "
            f"VALUES (%s, %s, {marks}, %s, NULL, NOW(3)) "
            f"ON DUPLICATE KEY UPDATE status = VALUES(status), {updates}, financials = VALUES(financials), "
            "error = NULL, fetched_at = NOW(3)",
            [instrument_id, status, *values, json.dumps(profile.financials) if profile.financials else None],
        )
    conn.commit()


def profile_error(conn, instrument_id: int, error: str) -> None:
    """Falha transitória: guarda o erro e mantém os dados anteriores (volta a tentar na próxima execução)."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO company_profiles (instrument_id, status, error) VALUES (%s, 'ok', %s) "
            "ON DUPLICATE KEY UPDATE error = VALUES(error)",
            (instrument_id, error[:255]),
        )
    conn.commit()
