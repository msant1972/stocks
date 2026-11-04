"""Alertas SAXO: email quando uma ordem enviada à SAXO termina (executada, expirada ou cancelada fora da aplicação; ou só
«já não está aberta» quando a SAXO não deu o histórico). A API regista os avisos em saxo_notifications; este módulo envia
um email por utilizador com os pendentes. Um envio falhado volta a ser tentado (até 2 dias); um resultado incerto não é
reenviado."""
import logging
from email.message import EmailMessage

from .mailer import SendFailed, SendUncertain

log = logging.getLogger(__name__)

SUBJECT = "Stocks: ordens SAXO executadas, expiradas ou canceladas"
KIND = {"filled": "Executada", "expired": "Expirada", "cancelled": "Cancelada", "ended": "Já não está aberta"}
MAX_AGE_DAYS = 2


def pending(conn) -> dict:
    """Avisos por enviar, por utilizador com email activo e a preferência ligada (por omissão está ligada)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT n.id, n.user_id, n.kind, u.email, u.name, o.side, o.quantity, o.order_type, o.limit_price, o.stop_price, "
            "o.saxo_order_id, o.filled_quantity, o.fill_price, i.symbol "
            "FROM saxo_notifications n JOIN users u ON u.id = n.user_id AND u.disabled_at IS NULL "
            "JOIN saxo_orders o ON o.id = n.order_id JOIN instruments i ON i.id = o.instrument_id "
            "LEFT JOIN saxo_alert_settings s ON s.user_id = n.user_id "
            "WHERE n.emailed_at IS NULL AND COALESCE(s.email_enabled, 1) = 1 "
            "AND n.created_at >= NOW(3) - INTERVAL %s DAY ORDER BY n.id",
            (MAX_AGE_DAYS,),
        )
        rows = cur.fetchall()
    conn.commit()
    by_user: dict = {}
    for r in rows:
        by_user.setdefault(r["user_id"], []).append(r)
    return by_user


def _num(d) -> str:
    return f"{d.normalize():f}"


def describe(r: dict) -> str:
    side = "Compra" if r["side"] == "buy" else "Venda"
    t = r["order_type"]
    if t == "limit" and r["limit_price"] is not None:
        kind = f"limitada a {_num(r['limit_price'])}"
    elif t == "stop" and r.get("stop_price") is not None:
        kind = f"stop a {_num(r['stop_price'])}"
    elif t == "trailing_stop":
        kind = "stop móvel"
    else:
        kind = "a mercado"
    ref = f" (SAXO {r['saxo_order_id']})" if r["saxo_order_id"] else ""
    state = KIND.get(r.get("kind") or "ended", "Já não está aberta")
    if r.get("kind") == "filled" and r.get("filled_quantity") and r.get("fill_price") is not None:
        state += f": {r['filled_quantity']} a {_num(r['fill_price'])}"
    return f"- {state} — {side} {kind} de {r['quantity']} {r['symbol']}{ref}"


def build_message(sender: str, recipient: str, name: str, rows: list, app_url: str | None) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = SUBJECT
    msg["From"] = sender
    msg["To"] = recipient
    lines = [f"Olá {name},", "", "Estas ordens enviadas à conta de simulação da SAXO Bank terminaram:", ""]
    lines += [describe(r) for r in rows]
    lines += ["", "Confirme o resultado na plataforma da SAXO. "
              + (f"Ver as ordens: {app_url.rstrip('/')}/saxo/ordens" if app_url else "")]
    lines += ["", "É uma conta de simulação: não é dinheiro real."]
    msg.set_content("\n".join(lines).rstrip() + "\n")
    return msg


def notify(conn, settings, mailer, dry_run: bool = False) -> int:
    """Envia os avisos pendentes. Devolve quantos emails foram enviados."""
    sender = settings.smtp.sender if settings.smtp else "stocks@localhost"
    sent = 0
    for rows in pending(conn).values():
        msg = build_message(sender, rows[0]["email"], rows[0]["name"], rows, settings.app_url)
        ids = [r["id"] for r in rows]
        if dry_run:
            mailer.send(msg)
            sent += 1
            continue
        status, error = "sent", None
        try:
            mailer.send(msg)
            sent += 1
        except SendFailed as exc:
            status, error = "failed", str(exc)
        except SendUncertain as exc:
            status, error = "uncertain", str(exc)
        with conn.cursor() as cur:
            if status == "failed":  # fica por enviar; volta a tentar na próxima execução
                cur.execute("UPDATE saxo_notifications SET email_error = %s WHERE id IN %s", (error[:255], ids))
            else:  # enviado ou incerto: nunca se reenvia
                cur.execute("UPDATE saxo_notifications SET emailed_at = NOW(3), email_error = %s WHERE id IN %s",
                            (error and error[:255], ids))
        conn.commit()
        if error:
            log.warning("aviso SAXO para %s: %s: %s", rows[0]["email"], status, error)
    return sent
