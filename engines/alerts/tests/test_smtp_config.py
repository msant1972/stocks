import base64

from alerts.__main__ import cmd_test
from alerts.config import resolve_smtp, smtp_from_db, SmtpSettings
from alerts.secrets import decrypt, load_key

# Vector gerado por api/src/secrets.js (chave = 32 bytes 0x07, iv = 12 bytes 0x01): garante que a API
# (Node) e o motor (Python) usam exactamente o mesmo formato.
KEY = bytes([7] * 32)
VECTOR = "v1:AQEBAQEBAQEBAQEBUiNQ+Wgsb4ICwrk7S7rESAaA5dbmzY0jobWvUhUaA1zciw=="


def test_decifra_o_formato_da_api():
    assert decrypt(KEY, VECTOR) == "palavra-passe-smtp"


def test_chave_por_variavel_ou_ficheiro(tmp_path):
    b64 = base64.b64encode(KEY).decode()
    assert load_key({"STOCKS_SECRET_KEY": b64}) == KEY
    f = tmp_path / "secret.key"
    f.write_text(b64 + "\n")
    assert load_key({"STOCKS_SECRET_KEY_FILE": str(f)}) == KEY
    assert load_key({"STOCKS_SECRET_KEY_FILE": str(tmp_path / "nao-existe")}) is None


def test_configuracao_da_bd_tem_prioridade_sobre_o_ambiente(conn, db, settings):
    env_smtp = SmtpSettings("env.exemplo.pt", 587, None, None, "env@exemplo.pt", "starttls")
    s = settings.__class__(**{**settings.__dict__, "smtp": env_smtp})
    assert resolve_smtp(conn, s, KEY) is env_smtp  # sem linha na BD: usa o ambiente
    db.exec("INSERT INTO smtp_settings (id, host, port, security, username, password_enc, sender) "
            "VALUES (1, 'smtp.exemplo.pt', 465, 'ssl', 'alertas', %s, 'Stocks <alertas@exemplo.pt>')", (VECTOR,))
    smtp = resolve_smtp(conn, s, KEY)
    assert (smtp.host, smtp.port, smtp.security, smtp.user, smtp.password, smtp.sender) == (
        "smtp.exemplo.pt", 465, "ssl", "alertas", "palavra-passe-smtp", "Stocks <alertas@exemplo.pt>")


def test_sem_palavra_passe_nao_precisa_de_chave(conn, db):
    db.exec("INSERT INTO smtp_settings (id, host, port, security, sender) VALUES (1, 'relay', 25, 'none', 'a@b.pt')")
    smtp = smtp_from_db(conn, None)
    assert (smtp.user, smtp.password) == (None, None)


def test_email_de_teste_sem_configuracao(capsys):
    assert cmd_test(None, "ana@exemplo.pt") == 2
    assert "não configurado" in capsys.readouterr().out
