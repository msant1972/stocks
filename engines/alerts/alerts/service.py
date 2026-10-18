"""Avaliação das regras e envio dos resumos."""
import logging
from dataclasses import dataclass, field

import pymysql
import pymysql.cursors

from .config import Settings
from .digest import DigestEvent, build_message
from .mailer import SendFailed, SendUncertain
from .rules import evaluate

log = logging.getLogger(__name__)


def connect(settings: Settings):
    conn = pymysql.connect(
        host=settings.db_host, port=settings.db_port, user=settings.db_user, password=settings.db_password,
        database=settings.db_name, autocommit=False, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
    )
    with conn.cursor() as cur:
        cur.execute("SET time_zone = '+00:00'")
    return conn


@dataclass
class RunResult:
    rules_evaluated: int = 0
    events: int = 0
    sent: int = 0
    failed: int = 0
    uncertain: int = 0
    deferred: int = 0          # utilizadores adiados pelo intervalo mínimo entre emails
    recovered: int = 0         # envios interrompidos marcados como incertos
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (f"{self.rules_evaluated} regras avaliadas, {self.events} eventos novos, {self.sent} resumos enviados, "
                f"{self.failed} falhados, {self.uncertain} incertos, {self.deferred} adiados")


class Tx:
    """Em --dry-run nada é gravado: os commits são ignorados e tudo é revertido no fim."""

    def __init__(self, conn, dry_run: bool):
        self.conn, self.dry_run = conn, dry_run

    def commit(self):
        if not self.dry_run:
            self.conn.commit()

    def rollback(self):
        if not self.dry_run:
            self.conn.rollback()


def recover_stale_deliveries(conn, tx: Tx, settings: Settings) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE email_deliveries SET status = 'uncertain', finished_at = NOW(3), "
            "error = 'envio interrompido; o email pode ter sido entregue' "
            "WHERE status = 'sending' AND created_at < NOW(3) - INTERVAL %s MINUTE",
            (settings.stale_sending_minutes,),
        )
        n = cur.rowcount
    tx.commit()
    return n


def evaluate_rules(conn, tx: Tx) -> tuple[int, int]:
    """Avalia cada regra activa sobre a última sessão do instrumento, uma só vez por sessão."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.id FROM alert_rules r JOIN instruments i ON i.id = r.instrument_id
             WHERE r.active AND i.status = 'active' AND i.last_session IS NOT NULL
               AND (r.last_evaluated_session IS NULL OR r.last_evaluated_session < i.last_session)
             ORDER BY r.id
            """
        )
        ids = [r["id"] for r in cur.fetchall()]
    tx.commit()

    evaluated = events = 0
    for rule_id in ids:
        try:
            with conn.cursor() as cur:
                # O bloqueio da regra impede que duas execuções avaliem a mesma regra em simultâneo.
                cur.execute(
                    "SELECT id, instrument_id, kind, threshold, last_state, last_evaluated_session "
                    "FROM alert_rules WHERE id = %s AND active FOR UPDATE",
                    (rule_id,),
                )
                rule = cur.fetchone()
                if rule is None:
                    tx.rollback()
                    continue
                cur.execute(
                    "SELECT session_date, close FROM daily_quotes WHERE instrument_id = %s "
                    "ORDER BY session_date DESC LIMIT 2",
                    (rule["instrument_id"],),
                )
                quotes = cur.fetchall()
                if not quotes or (rule["last_evaluated_session"] and rule["last_evaluated_session"] >= quotes[0]["session_date"]):
                    tx.rollback()
                    continue
                latest = quotes[0]
                previous = quotes[1]["close"] if len(quotes) > 1 else None
                last_state = None if rule["last_state"] is None else bool(rule["last_state"])
                ev = evaluate(rule["kind"], rule["threshold"], latest["close"], previous, last_state)
                if ev.fire:
                    cur.execute(
                        "INSERT IGNORE INTO alert_events (rule_id, session_date, close, previous_close, change_pct) "
                        "VALUES (%s, %s, %s, %s, %s)",
                        (rule_id, latest["session_date"], latest["close"], previous, ev.change_pct),
                    )
                    events += cur.rowcount
                # updated_at = updated_at: a avaliação não conta como edição da regra pelo utilizador.
                cur.execute(
                    "UPDATE alert_rules SET last_state = %s, last_evaluated_session = %s, updated_at = updated_at "
                    "WHERE id = %s",
                    (ev.state, latest["session_date"], rule_id),
                )
            tx.commit()
            evaluated += 1
        except pymysql.MySQLError:
            log.exception("regra %s: erro na avaliação", rule_id)
            tx.rollback()
    return evaluated, events


PENDING_EVENTS = """
    SELECT e.id, e.session_date, e.close, e.change_pct, r.kind, r.threshold, i.symbol, i.name
      FROM alert_events e
      JOIN alert_rules r ON r.id = e.rule_id
      JOIN instruments i ON i.id = r.instrument_id
     WHERE r.user_id = %s AND e.delivery_id IS NULL AND r.active
       AND e.session_date >= UTC_DATE() - INTERVAL %s DAY
     ORDER BY i.symbol, e.session_date
"""


def deliver(conn, tx: Tx, settings: Settings, mailer, result: RunResult) -> None:
    """Um resumo por utilizador com todos os eventos ainda não notificados."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT r.user_id FROM alert_events e
              JOIN alert_rules r ON r.id = e.rule_id
              JOIN users u ON u.id = r.user_id
             WHERE e.delivery_id IS NULL AND r.active AND u.disabled_at IS NULL
               AND e.session_date >= UTC_DATE() - INTERVAL %s DAY
            """,
            (settings.max_event_age_days,),
        )
        user_ids = [r["user_id"] for r in cur.fetchall()]
    tx.commit()

    for user_id in user_ids:
        with conn.cursor() as cur:
            # Bloquear o utilizador serializa execuções concorrentes para o mesmo destinatário.
            cur.execute("SELECT id, email, name FROM users WHERE id = %s AND disabled_at IS NULL FOR UPDATE", (user_id,))
            user = cur.fetchone()
            if user is None:
                tx.rollback()
                continue
            cur.execute(
                "SELECT 1 FROM email_deliveries WHERE user_id = %s AND status IN ('sending','sent','uncertain') "
                "AND created_at > NOW(3) - INTERVAL %s MINUTE LIMIT 1",
                (user_id, settings.min_interval_minutes),
            )
            if cur.fetchone():
                tx.rollback()
                result.deferred += 1
                log.info("utilizador %s: email recente; eventos ficam para a próxima execução", user_id)
                continue
            cur.execute(PENDING_EVENTS + " FOR UPDATE", (user_id, settings.max_event_age_days))
            rows = cur.fetchall()
            if not rows:
                tx.rollback()
                continue
            events = [DigestEvent(r["symbol"], r["name"], r["kind"], r["threshold"], r["session_date"],
                                  r["close"], r["change_pct"]) for r in rows]
            sender = settings.smtp.sender if settings.smtp else "stocks@localhost"
            msg = build_message(sender, user["email"], user["name"], events, settings.app_url)
            cur.execute(
                "INSERT INTO email_deliveries (user_id, recipient, subject, status, event_count) "
                "VALUES (%s, %s, %s, 'sending', %s)",
                (user_id, user["email"], msg["Subject"], len(events)),
            )
            delivery_id = cur.lastrowid
            ids = [r["id"] for r in rows]
            cur.execute(
                f"UPDATE alert_events SET delivery_id = %s WHERE id IN ({','.join(['%s'] * len(ids))})",
                (delivery_id, *ids),
            )
        tx.commit()

        status, error = "sent", None
        try:
            mailer.send(msg)
        except SendFailed as exc:
            status, error = "failed", str(exc)
        except SendUncertain as exc:
            status, error = "uncertain", str(exc)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE email_deliveries SET status = %s, error = %s, finished_at = NOW(3) WHERE id = %s",
                (status, error and error[:2000], delivery_id),
            )
            if status == "failed":
                # Envio recusado: os eventos voltam a ficar pendentes e entram no próximo resumo.
                cur.execute("UPDATE alert_events SET delivery_id = NULL WHERE delivery_id = %s", (delivery_id,))
        tx.commit()
        setattr(result, status, getattr(result, status) + 1)
        if error:
            log.warning("utilizador %s: envio %s: %s", user_id, status, error)
            result.errors.append(f"utilizador {user_id}: {status}: {error}")
        else:
            log.info("utilizador %s: resumo com %s eventos enviado", user_id, len(events))


def start_run(conn, kind: str) -> int:
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


def run(conn, settings: Settings, mailer, dry_run: bool = False) -> RunResult:
    tx = Tx(conn, dry_run)
    result = RunResult()
    run_id = None if dry_run else start_run(conn, "alerts")
    try:
        result.recovered = recover_stale_deliveries(conn, tx, settings)
        result.rules_evaluated, result.events = evaluate_rules(conn, tx)
        deliver(conn, tx, settings, mailer, result)
    except Exception as exc:
        conn.rollback()
        if run_id is not None:
            finish_run(conn, run_id, False, f"erro: {exc}")
        raise
    if dry_run:
        conn.rollback()
    else:
        finish_run(conn, run_id, not result.errors, result.summary())
    return result
