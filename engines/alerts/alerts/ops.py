"""Aviso operacional aos administradores: recolhas ou alertas que falharam, ficaram presos ou não correram,
e dados parados. Corre num timer próprio (stocks-ops.timer), independente da recolha diária, para detectar
também o caso em que a recolha nem chegou a correr. No máximo um email por dia."""
import logging
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from zoneinfo import ZoneInfo

from .digest import fmt_date
from .mailer import SendFailed, SendUncertain

log = logging.getLogger(__name__)

MARKET_TZ = ZoneInfo("Europe/Lisbon")
SUBJECT = "Stocks: aviso operacional"
# A recolha diária corre às 19:01 de Lisboa; depois desta hora já devia ter corrido nos dias úteis.
DAILY_EXPECTED_AFTER = 20
STUCK_HOURS = 3
STALE_BUSINESS_DAYS = 2  # tolera um feriado da bolsa
KIND_LABEL = {"fetch_update": "recolha diária", "fetch_intraday": "recolha horária", "alerts": "alertas"}


def run_label(r: dict) -> str:
    """Ex.: «recolha diária de 14/10 18:01 UTC»."""
    return f"{KIND_LABEL.get(r['kind'], r['kind'])} de {r['started_at']:%d/%m %H:%M} UTC"


def business_days_between(start: date, end: date) -> int:
    """Dias úteis (segunda a sexta) depois de start até end, inclusive."""
    n, d = 0, start
    while d < end:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def check(conn, now: datetime | None = None) -> list[str]:
    """Problemas operacionais encontrados, como frases para o email (lista vazia: está tudo bem)."""
    local = (now or datetime.now(MARKET_TZ)).astimezone(MARKET_TZ)
    problems = []
    with conn.cursor() as cur:
        cur.execute(
            "SELECT kind, started_at, detail FROM job_runs WHERE status = 'failed' "
            "AND started_at >= NOW(3) - INTERVAL 24 HOUR ORDER BY id"
        )
        for r in cur.fetchall():
            problems.append(f"A {run_label(r)} falhou: {r['detail'] or 'sem detalhe'}")
        cur.execute(
            "SELECT kind, started_at FROM job_runs WHERE status = 'running' AND started_at < NOW(3) - INTERVAL %s HOUR",
            (STUCK_HOURS,),
        )
        for r in cur.fetchall():
            problems.append(f"A {run_label(r)} continua em curso (presa?)")
        if local.weekday() < 5 and local.hour >= DAILY_EXPECTED_AFTER:
            start_utc = datetime.combine(local.date(), datetime.min.time(), MARKET_TZ).astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
            cur.execute("SELECT COUNT(*) AS n FROM job_runs WHERE kind = 'fetch_update' AND started_at >= %s", (start_utc,))
            if cur.fetchone()["n"] == 0:
                problems.append("A recolha diária de hoje (19:01) não correu")
        cur.execute(
            "SELECT i.symbol, LEFT(j.last_error, 120) AS error FROM fetch_jobs j JOIN instruments i ON i.id = j.instrument_id "
            "WHERE j.status = 'failed' AND i.status = 'active' AND j.finished_at >= NOW(3) - INTERVAL 24 HOUR ORDER BY i.symbol"
        )
        failed = cur.fetchall()
        if failed:
            shown = "; ".join(f"{r['symbol']} ({r['error']})" for r in failed[:10])
            more = f" e mais {len(failed) - 10}" if len(failed) > 10 else ""
            problems.append(f"{len(failed)} instrumentos com a recolha falhada nas últimas 24 horas: {shown}{more}")
        cur.execute("SELECT MAX(last_session) AS last FROM instruments WHERE status = 'active'")
        last = cur.fetchone()["last"]
        if last is not None and business_days_between(last, local.date()) >= STALE_BUSINESS_DAYS:
            problems.append(f"Os dados estão parados: a última sessão gravada é de {fmt_date(last)}")
    conn.commit()
    return problems


def already_sent_today(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM email_deliveries WHERE subject = %s AND status IN ('sending', 'sent', 'uncertain') "
            "AND created_at >= NOW(3) - INTERVAL 20 HOUR LIMIT 1",
            (SUBJECT,),
        )
        found = cur.fetchone() is not None
    conn.commit()
    return found


def build_message(sender: str, recipient: str, name: str, problems: list[str], app_url: str | None) -> EmailMessage:
    lines = [f"Olá {name},", "", "A verificação operacional da aplicação Stocks encontrou:", ""]
    lines += [f"• {p}" for p in problems]
    lines += ["", "Detalhes: journalctl -u stocks-daily -u stocks-intraday -u stocks-fetcher-run no servidor"]
    if app_url:
        lines += [f"Estado dos dados: {app_url.rstrip('/')}/definicoes"]
    msg = EmailMessage()
    msg["Subject"] = SUBJECT
    msg["From"] = sender
    msg["To"] = recipient
    msg.set_content("\n".join(lines))
    return msg


def notify(conn, settings, mailer, problems: list[str], dry_run: bool = False) -> int:
    """Envia o aviso a cada administrador activo. Devolve quantos foram enviados.
    Em dry_run só mostra as mensagens (mailer de impressão), sem as registar nem contar para o limite diário."""
    if not problems or (not dry_run and already_sent_today(conn)):
        return 0
    with conn.cursor() as cur:
        cur.execute("SELECT id, email, name FROM users WHERE is_admin AND disabled_at IS NULL ORDER BY id")
        admins = cur.fetchall()
    conn.commit()
    sender = settings.smtp.sender if settings.smtp else "stocks@localhost"
    sent = 0
    for a in admins:
        msg = build_message(sender, a["email"], a["name"], problems, settings.app_url)
        if dry_run:
            mailer.send(msg)
            sent += 1
            continue
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO email_deliveries (user_id, recipient, subject, status, event_count) VALUES (%s, %s, %s, 'sending', 0)",
                (a["id"], a["email"], SUBJECT),
            )
            delivery_id = cur.lastrowid
        conn.commit()
        status, error = "sent", None
        try:
            mailer.send(msg)
            sent += 1
        except SendFailed as exc:
            status, error = "failed", str(exc)
        except SendUncertain as exc:
            status, error = "uncertain", str(exc)
        with conn.cursor() as cur:
            cur.execute("UPDATE email_deliveries SET status = %s, error = %s, finished_at = NOW(3) WHERE id = %s",
                        (status, error and error[:2000], delivery_id))
        conn.commit()
        if error:
            log.warning("aviso operacional para %s: %s: %s", a["email"], status, error)
    return sent
