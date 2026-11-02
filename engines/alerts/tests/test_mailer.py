import smtplib
from email.message import EmailMessage

import pytest

from alerts.config import SmtpSettings
from alerts.mailer import SendFailed, SmtpMailer


class FakeSmtp:
    """Servidor SMTP simulado: aceita a mensagem; o QUIT pode falhar."""

    def __init__(self, *args, quit_error=None, data_code=250, **kwargs):
        self.quit_error, self.data_code, self.closed = quit_error, data_code, False

    def ehlo(self): return 250, b"ok"
    def mail(self, sender): return 250, b"ok"
    def rcpt(self, to): return 250, b"ok"
    def data(self, payload): return self.data_code, b"queued"
    def close(self): self.closed = True

    def quit(self):
        if self.quit_error:
            raise self.quit_error
        return 221, b"bye"


def message():
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = "stocks@exemplo.pt", "ana@exemplo.pt", "teste"
    msg.set_content("olá")
    return msg


SETTINGS = SmtpSettings(host="smtp.exemplo.pt", port=587, user=None, password=None, sender="stocks@exemplo.pt", security="none")


@pytest.mark.parametrize("error", [ConnectionResetError("reset"), smtplib.SMTPResponseException(421, b"adeus")])
def test_erro_no_quit_depois_de_aceite_nao_e_falha(monkeypatch, error):
    servers = []
    monkeypatch.setattr(smtplib, "SMTP", lambda *a, **k: servers.append(FakeSmtp(quit_error=error)) or servers[-1])
    SmtpMailer(SETTINGS).send(message())  # não levanta: a mensagem foi aceite
    assert servers[0].closed


def test_mensagem_recusada_continua_a_ser_falha(monkeypatch):
    monkeypatch.setattr(smtplib, "SMTP", lambda *a, **k: FakeSmtp(data_code=554))
    with pytest.raises(SendFailed):
        SmtpMailer(SETTINGS).send(message())
