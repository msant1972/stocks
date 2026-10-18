"""Envio por SMTP, distinguindo falha certa de resultado incerto."""
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid

from .config import SmtpSettings


class SendFailed(Exception):
    """O servidor não aceitou a mensagem; é seguro voltar a tentar mais tarde."""


class SendUncertain(Exception):
    """A ligação falhou depois de a mensagem ser transmitida: pode ter sido aceite. Não se reenvia."""


class SmtpMailer:
    def __init__(self, settings: SmtpSettings):
        self.s = settings

    def send(self, msg: EmailMessage) -> None:
        s = self.s
        if "Message-ID" not in msg:
            msg["Message-ID"] = make_msgid(domain=s.sender.rpartition("@")[2] or None)
        try:
            context = ssl.create_default_context()
            if s.security == "ssl":
                smtp = smtplib.SMTP_SSL(s.host, s.port, timeout=s.timeout, context=context)
            else:
                smtp = smtplib.SMTP(s.host, s.port, timeout=s.timeout)
            with smtp:
                smtp.ehlo()
                if s.security == "starttls":
                    smtp.starttls(context=context)
                    smtp.ehlo()
                if s.user:
                    smtp.login(s.user, s.password or "")
                code, resp = smtp.mail(s.sender)
                if code != 250:
                    raise SendFailed(f"MAIL FROM recusado: {code} {resp!r}")
                code, resp = smtp.rcpt(msg["To"])
                if code not in (250, 251):
                    raise SendFailed(f"destinatário recusado: {code} {resp!r}")
                # A partir daqui a mensagem é transmitida: uma quebra de ligação deixa o resultado incerto.
                try:
                    code, resp = smtp.data(msg.as_bytes())
                except smtplib.SMTPDataError as exc:
                    raise SendFailed(f"mensagem recusada: {exc.smtp_code} {exc.smtp_error!r}") from exc
                except (smtplib.SMTPServerDisconnected, OSError) as exc:
                    raise SendUncertain(f"ligação perdida durante o envio: {exc}") from exc
                if code != 250:
                    raise SendFailed(f"mensagem recusada: {code} {resp!r}")
        except (SendFailed, SendUncertain):
            raise
        except (smtplib.SMTPException, OSError) as exc:
            raise SendFailed(f"{type(exc).__name__}: {exc}") from exc


class PrintMailer:
    """Escreve as mensagens no terminal em vez de as enviar (modo --dry-run)."""

    def __init__(self, out):
        self.out = out

    def send(self, msg: EmailMessage) -> None:
        body = msg.get_body(preferencelist=("plain",)).get_content()
        self.out.write(f"Para: {msg['To']}\nAssunto: {msg['Subject']}\n\n{body}\n{'=' * 60}\n")
