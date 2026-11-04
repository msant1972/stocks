from alerts import saxo


def make_notification(db, user_id, limit="30.46", order_type="limit", kind="ended", filled=None):
    galp = db.instrument(f"DBK{user_id}{limit}.DE")
    order = db.exec(
        "INSERT INTO saxo_orders (user_id, instrument_id, idempotency_key, side, quantity, order_type, limit_price, status, saxo_order_id, "
        "filled_quantity, fill_price) VALUES (%s, %s, %s, 'buy', 10, %s, %s, 'ended', '5041484162', %s, %s)",
        (user_id, galp, f"chave-{user_id}-{limit}-{kind}", order_type, limit if order_type == "limit" else None,
         filled and filled[0], filled and filled[1]),
    )
    return db.exec("INSERT INTO saxo_notifications (user_id, order_id, kind) VALUES (%s, %s, %s)", (user_id, order, kind))


def test_envia_um_email_por_utilizador_com_os_avisos_pendentes(conn, db, settings, mailer):
    ana = db.user("ana@exemplo.pt")
    make_notification(db, ana, "30.46")
    make_notification(db, ana, "31.00")
    assert saxo.notify(conn, settings, mailer) == 1
    msg = mailer.sent[0]
    body = msg.get_content()
    assert msg["To"] == "ana@exemplo.pt" and msg["Subject"] == saxo.SUBJECT
    assert "Já não está aberta — Compra limitada a 30.46 de 10 DBK" in body and "(SAXO 5041484162)" in body
    assert "Compra limitada a 31 de 10 DBK" in body
    assert "não é dinheiro real" in body
    assert db.count("saxo_notifications", "emailed_at IS NULL") == 0
    # Nada de novo: não volta a enviar.
    assert saxo.notify(conn, settings, mailer) == 0


def test_respeita_a_preferencia_e_utilizadores_desactivados(conn, db, settings, mailer):
    ana, rui, eva = db.user("ana@exemplo.pt"), db.user("rui@exemplo.pt"), db.user("eva@exemplo.pt", disabled=True)
    for u in (ana, rui, eva):
        make_notification(db, u)
    db.exec("INSERT INTO saxo_alert_settings (user_id, email_enabled) VALUES (%s, 0)", (ana,))
    assert saxo.notify(conn, settings, mailer) == 1
    assert [m["To"] for m in mailer.sent] == ["rui@exemplo.pt"]


def test_falha_certa_volta_a_tentar_e_incerta_nao_reenvia(conn, db, settings, mailer):
    ana, rui = db.user("ana@exemplo.pt"), db.user("rui@exemplo.pt")
    make_notification(db, ana)
    mailer.mode = "fail"
    assert saxo.notify(conn, settings, mailer) == 0
    assert db.count("saxo_notifications", "emailed_at IS NULL AND email_error IS NOT NULL") == 1
    mailer.mode = "ok"
    assert saxo.notify(conn, settings, mailer) == 1
    make_notification(db, rui)
    mailer.mode = "uncertain"
    saxo.notify(conn, settings, mailer)
    mailer.mode = "ok"
    assert saxo.notify(conn, settings, mailer) == 0


def test_ordem_a_mercado_e_dry_run_nao_grava(conn, db, settings):
    ana = db.user("ana@exemplo.pt")
    make_notification(db, ana, order_type="market")
    out = []

    class Out:
        def write(self, text):
            out.append(text)

    from alerts.mailer import PrintMailer
    assert saxo.notify(conn, settings, PrintMailer(Out()), dry_run=True) == 1
    assert "Compra a mercado de 10 DBK" in "".join(out)
    assert db.count("saxo_notifications", "emailed_at IS NULL") == 1


def test_estado_real_executada_expirada_cancelada(conn, db, settings, mailer):
    ana = db.user("ana@exemplo.pt")
    make_notification(db, ana, "9.50", kind="filled", filled=(10, "9.4825"))
    make_notification(db, ana, "9.60", kind="expired")
    make_notification(db, ana, "9.70", kind="cancelled")
    assert saxo.notify(conn, settings, mailer) == 1
    body = mailer.sent[0].get_content()
    assert "Executada: 10 a 9.4825 — Compra limitada a 9.5 de 10 DBK" in body
    assert "Expirada — Compra limitada a 9.6" in body
    assert "Cancelada — Compra limitada a 9.7" in body
