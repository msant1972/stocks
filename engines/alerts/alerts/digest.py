"""Composição do email de resumo, em português de Portugal."""
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from email.message import EmailMessage
from html import escape

MONTHS = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."]


@dataclass(frozen=True)
class DigestEvent:
    symbol: str
    name: str | None
    kind: str
    threshold: Decimal
    session_date: date
    close: Decimal
    change_pct: Decimal | None


def fmt_date(d: date) -> str:
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def fmt_number(value: Decimal, places: int = 2) -> str:
    """12345.678 -> '12 345,68' (espaço fino inseparável como separador de milhares)."""
    q = value.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    sign = "-" if q < 0 else ""
    integer, _, frac = f"{abs(q):f}".partition(".")
    groups = []
    while len(integer) > 3:
        groups.insert(0, integer[-3:])
        integer = integer[:-3]
    groups.insert(0, integer)
    out = " ".join(groups)
    return f"{sign}{out},{frac}" if places else f"{sign}{out}"


def fmt_eur(value: Decimal) -> str:
    return f"{fmt_number(value)} €"


def fmt_pct(value: Decimal) -> str:
    return f"{'+' if value > 0 else ''}{fmt_number(value)}%"


def describe(e: DigestEvent) -> str:
    """Frase com a condição e o valor observado."""
    if e.kind == "close_above":
        cond = f"fecho acima de {fmt_eur(e.threshold)}"
    elif e.kind == "close_below":
        cond = f"fecho abaixo de {fmt_eur(e.threshold)}"
    elif e.kind == "change_up":
        cond = f"subida de pelo menos {fmt_number(e.threshold)}% numa sessão"
    else:
        cond = f"descida de pelo menos {fmt_number(e.threshold)}% numa sessão"
    observed = f"fecho de {fmt_eur(e.close)}"
    if e.change_pct is not None:
        observed += f" ({fmt_pct(e.change_pct)} face à sessão anterior)"
    return f"{cond}: {observed} em {fmt_date(e.session_date)}"


FOOTER = (
    "As condições são avaliadas com cotações diárias, não em tempo real. "
    "A carteira e as operações da aplicação são simuladas; este email não é uma recomendação de investimento."
)


def build_message(sender: str, recipient: str, user_name: str, events: list[DigestEvent],
                  app_url: str | None) -> EmailMessage:
    events = sorted(events, key=lambda e: (e.symbol, e.session_date))
    n = len(events)
    latest = max(e.session_date for e in events)
    subject = f"Stocks: {n} {'alerta' if n == 1 else 'alertas'} · sessão de {fmt_date(latest)}"

    lines = [f"Olá {user_name},", "", f"{'Disparou' if n == 1 else 'Dispararam'} {n} {'alerta' if n == 1 else 'alertas'} após a actualização das cotações:", ""]
    for e in events:
        label = f"{e.symbol}" + (f" — {e.name}" if e.name else "")
        lines += [f"• {label}", f"  {describe(e)}", ""]
    if app_url:
        lines += [f"Gerir alertas: {app_url.rstrip('/')}/alertas", ""]
    lines += ["—", FOOTER]
    text = "\n".join(lines)

    items = "".join(
        f"<li style=\"margin:0 0 12px\"><strong>{escape(e.symbol)}</strong>"
        f"{' — ' + escape(e.name) if e.name else ''}<br>"
        f"<span style=\"color:#555963\">{escape(describe(e))}</span></li>"
        for e in events
    )
    link = (f"<p><a href=\"{escape(app_url.rstrip('/'))}/alertas\" style=\"color:#005FCC\">Gerir alertas</a></p>"
            if app_url else "")
    html = (
        "<!doctype html><html lang=\"pt-PT\"><body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',"
        "Roboto,Helvetica,Arial,sans-serif;color:#1D1D1F;line-height:1.5;max-width:560px\">"
        f"<p>Olá {escape(user_name)},</p>"
        f"<p>{'Disparou' if n == 1 else 'Dispararam'} {n} {'alerta' if n == 1 else 'alertas'} após a actualização das cotações:</p>"
        f"<ul style=\"padding-left:20px\">{items}</ul>{link}"
        f"<p style=\"color:#555963;font-size:13px;border-top:1px solid #DADDE3;padding-top:12px\">{escape(FOOTER)}</p>"
        "</body></html>"
    )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = recipient
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    return msg
