from datetime import date, datetime

from alerts import ops

from .conftest import FakeMailer

# Quarta-feira, 21:00 de Lisboa: a recolha diária já devia ter corrido.
EVENING = datetime(2026, 10, 14, 21, 0, tzinfo=ops.MARKET_TZ)


def test_dias_uteis_entre_datas():
    assert ops.business_days_between(date(2026, 10, 16), date(2026, 10, 19)) == 1  # sexta → segunda
    assert ops.business_days_between(date(2026, 10, 14), date(2026, 10, 16)) == 2


def test_sem_problemas_nao_envia_nada(conn, db, settings):
    db.exec("INSERT INTO job_runs (kind, status, started_at) VALUES ('fetch_update', 'done', '2026-10-14 18:01:00')")
    galp = db.instrument("GALP.LS")
    db.exec("UPDATE instruments SET last_session = '2026-10-14' WHERE id = %s", (galp,))
    assert ops.check(conn, EVENING) == []


def test_detecta_falhas_recolha_em_falta_e_dados_parados(conn, db, settings):
    db.exec("INSERT INTO job_runs (kind, status, detail, started_at) VALUES ('alerts', 'failed', 'erro: SMTP', NOW(3))")
    galp = db.instrument("GALP.LS")
    db.exec("UPDATE instruments SET last_session = '2026-10-09' WHERE id = %s", (galp,))
    db.exec("INSERT INTO fetch_jobs (instrument_id, kind, status, last_error, finished_at) "
            "VALUES (%s, 'incremental', 'failed', '429', NOW(3))", (galp,))
    problems = ops.check(conn, EVENING)
    text = " | ".join(problems)
    assert "alertas" in text and "erro: SMTP" in text
    assert "recolha diária de hoje" in text
    assert "GALP.LS (429)" in text
    assert "parados" in text


def test_aviso_aos_administradores_uma_vez_por_dia(conn, db, settings):
    db.exec("INSERT INTO users (email, name, password_hash, is_admin) VALUES ('admin@exemplo.pt', 'Admin', 'x', TRUE)")
    db.user("ana@exemplo.pt")
    mailer = FakeMailer()
    assert ops.notify(conn, settings, mailer, ["A recolha diária falhou"]) == 1
    assert [m["To"] for m in mailer.sent] == ["admin@exemplo.pt"]
    assert "A recolha diária falhou" in mailer.sent[0].get_content()
    assert ops.notify(conn, settings, mailer, ["outro problema"]) == 0  # já avisado hoje
    assert ops.notify(conn, settings, FakeMailer(), ["x"], dry_run=True) == 1  # pré-visualização não conta
