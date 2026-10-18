import io

from alerts.mailer import PrintMailer
from alerts.service import run


def test_alerta_de_nivel_notifica_uma_vez_e_volta_a_armar(conn, db, settings, mailer):
    ana = db.user("ana@exemplo.pt")
    galp = db.instrument("GALP.LS")
    db.rule(ana, galp, "close_above", "15")

    def session(close, days_ago):
        db.quote(galp, close, days_ago=days_ago)
        # Afasta o último envio para o intervalo mínimo entre emails não interferir.
        db.exec("UPDATE email_deliveries SET created_at = NOW(3) - INTERVAL 2 HOUR")
        return run(conn, settings, mailer)

    assert session("14.00", 5).events == 0       # abaixo do limite
    r = session("16.00", 4)                      # passa a estar acima: notifica
    assert (r.events, r.sent) == (1, 1)
    assert mailer.sent[0]["To"] == "ana@exemplo.pt"
    assert run(conn, settings, mailer).events == 0   # mesma sessão: não reavalia
    assert session("17.00", 3).events == 0       # continua acima: não repete
    assert session("14.50", 2).events == 0       # volta abaixo: rearma
    r = session("15.50", 1)                      # sobe outra vez: notifica
    assert (r.events, r.sent) == (1, 1)
    assert len(mailer.sent) == 2


def test_um_resumo_por_utilizador_com_todos_os_eventos(conn, db, settings, mailer):
    ana, rui = db.user("ana@exemplo.pt"), db.user("rui@exemplo.pt")
    galp, sie = db.instrument("GALP.LS"), db.instrument("SIE.DE")
    db.quote(galp, "10.00", days_ago=1)
    db.quote(galp, "11.00")
    db.quote(sie, "200.00")
    db.rule(ana, galp, "close_above", "10.5")
    db.rule(ana, galp, "change_up", "5")
    db.rule(ana, sie, "close_below", "250")
    db.rule(rui, sie, "close_below", "100")  # não se verifica

    r = run(conn, settings, mailer)
    assert (r.rules_evaluated, r.events, r.sent) == (4, 3, 1)
    assert len(mailer.sent) == 1
    assert mailer.sent[0]["Subject"].startswith("Stocks: 3 alertas")
    assert db.count("alert_events", "delivery_id IS NULL") == 0
    assert db.one("SELECT status, event_count FROM email_deliveries") == {"status": "sent", "event_count": 3}

    # Nada de novo: não há segundo email.
    assert run(conn, settings, mailer).sent == 0


def test_no_maximo_um_email_por_hora(conn, db, settings, mailer):
    ana = db.user("ana@exemplo.pt")
    galp = db.instrument("GALP.LS")
    db.quote(galp, "100", days_ago=2)
    db.quote(galp, "110", days_ago=1)
    db.rule(ana, galp, "change_up", "5")
    assert run(conn, settings, mailer).sent == 1

    db.quote(galp, "120", days_ago=0)
    r = run(conn, settings, mailer)
    assert (r.events, r.sent, r.deferred) == (1, 0, 1)
    assert db.count("alert_events", "delivery_id IS NULL") == 1

    db.exec("UPDATE email_deliveries SET created_at = NOW(3) - INTERVAL 61 MINUTE")
    assert run(conn, settings, mailer).sent == 1
    assert len(mailer.sent) == 2


def test_falha_smtp_devolve_eventos_ao_proximo_resumo(conn, db, settings, mailer):
    ana = db.user("ana@exemplo.pt")
    galp = db.instrument("GALP.LS")
    db.quote(galp, "20")
    db.rule(ana, galp, "close_above", "10")

    mailer.mode = "fail"
    r = run(conn, settings, mailer)
    assert (r.sent, r.failed) == (0, 1)
    assert db.count("alert_events", "delivery_id IS NULL") == 1
    assert db.one("SELECT status FROM job_runs WHERE kind = 'alerts'")["status"] == "failed"

    mailer.mode = "ok"
    r = run(conn, settings, mailer)
    assert r.sent == 1
    assert db.count("email_deliveries", "status = 'failed'") == 1
    assert db.count("email_deliveries", "status = 'sent'") == 1


def test_envio_incerto_nao_e_repetido(conn, db, settings, mailer):
    ana = db.user("ana@exemplo.pt")
    galp = db.instrument("GALP.LS")
    db.quote(galp, "20")
    db.rule(ana, galp, "close_above", "10")
    mailer.mode = "uncertain"
    assert run(conn, settings, mailer).uncertain == 1
    mailer.mode = "ok"
    db.exec("UPDATE email_deliveries SET created_at = NOW(3) - INTERVAL 2 HOUR")
    assert run(conn, settings, mailer).sent == 0
    assert mailer.sent == []


def test_envio_interrompido_passa_a_incerto(conn, db, settings, mailer):
    ana = db.user("ana@exemplo.pt")
    db.exec("INSERT INTO email_deliveries (user_id, recipient, subject, status, event_count, created_at) "
            "VALUES (%s, 'ana@exemplo.pt', 'x', 'sending', 1, NOW(3) - INTERVAL 1 HOUR)", (ana,))
    assert run(conn, settings, mailer).recovered == 1
    assert db.one("SELECT status FROM email_deliveries")["status"] == "uncertain"


def test_regras_inactivas_e_utilizadores_desactivados_nao_recebem(conn, db, settings, mailer):
    ana, off = db.user("ana@exemplo.pt"), db.user("off@exemplo.pt", disabled=True)
    galp = db.instrument("GALP.LS")
    db.quote(galp, "20")
    db.rule(ana, galp, "close_above", "10", active=False)
    db.rule(off, galp, "close_above", "10")
    r = run(conn, settings, mailer)
    assert r.sent == 0
    assert mailer.sent == []


def test_dry_run_nao_grava_nada(conn, db, settings):
    ana = db.user("ana@exemplo.pt")
    galp = db.instrument("GALP.LS")
    db.quote(galp, "20")
    db.rule(ana, galp, "close_above", "10")
    out = io.StringIO()
    r = run(conn, settings, PrintMailer(out), dry_run=True)
    assert (r.events, r.sent) == (1, 1)
    assert "Assunto: Stocks: 1 alerta" in out.getvalue()
    assert db.count("alert_events") == 0
    assert db.count("email_deliveries") == 0
    assert db.count("job_runs") == 0
    assert db.one("SELECT last_evaluated_session FROM alert_rules")["last_evaluated_session"] is None


def test_regista_a_execucao(conn, db, settings, mailer):
    run(conn, settings, mailer)
    row = db.one("SELECT status, detail FROM job_runs WHERE kind = 'alerts'")
    assert row["status"] == "done"
    assert "regras avaliadas" in row["detail"]
