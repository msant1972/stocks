import threading
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal

from fetcher import db
from fetcher.models import DailyQuote
from fetcher.service import run_pending

from .conftest import FakeProvider

TODAY = date(2026, 10, 16)


def count(conn, sql, *params):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        n = list(cur.fetchone().values())[0]
    conn.commit()
    return n


def instrument(conn, symbol):
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM instruments WHERE symbol = %s", (symbol,))
        row = cur.fetchone()
    conn.commit()
    return row


def test_initial_load_covers_three_years_of_weekdays(conn, settings):
    provider = FakeProvider()
    db.add_instrument(conn, "ASML.AS")
    assert run_pending(conn, provider, settings, TODAY) == 1

    row = instrument(conn, "ASML.AS")
    assert row["status"] == "active" and row["currency"] == "EUR"
    assert row["first_session"] >= date(2023, 10, 16)
    assert row["first_session"] <= date(2023, 10, 20)
    assert row["last_session"] == TODAY
    sessions = count(conn, "SELECT COUNT(*) FROM daily_quotes")
    assert 775 <= sessions <= 790
    # Fins-de-semana não são inventados.
    assert count(conn, "SELECT COUNT(*) FROM daily_quotes WHERE DAYOFWEEK(session_date) IN (1, 7)") == 0
    # Os dois anos mostrados nos gráficos já têm SMA200.
    assert count(conn, "SELECT COUNT(*) FROM daily_quotes WHERE session_date >= '2024-10-16' AND sma200 IS NULL") == 0


def test_backfill_extends_history_without_duplicates(conn, settings):
    provider = FakeProvider()
    db.add_instrument(conn, "SAP.DE")
    run_pending(conn, provider, replace(settings, history_years=2), TODAY)
    assert instrument(conn, "SAP.DE")["first_session"] >= date(2024, 10, 16)

    start = db.history_start(TODAY, 3) + timedelta(days=7)
    assert db.enqueue_backfill(conn, start) == 1
    assert db.enqueue_backfill(conn, start) == 0  # já há um pedido pendente
    run_pending(conn, provider, settings, TODAY)
    row = instrument(conn, "SAP.DE")
    assert row["status"] == "active" and row["first_session"] <= date(2023, 10, 20)
    assert count(conn, "SELECT COUNT(*) FROM daily_quotes") == count(conn, "SELECT COUNT(DISTINCT session_date) FROM daily_quotes")
    assert count(conn, "SELECT COUNT(*) FROM daily_quotes WHERE session_date >= '2024-10-16' AND sma200 IS NULL") == 0
    # Com o histórico completo, nada mais a pedir.
    assert db.enqueue_backfill(conn, start) == 0


def test_adding_twice_and_refetching_never_duplicates(conn, settings):
    provider = FakeProvider()
    assert db.add_instrument(conn, "SIE.DE")[1] is True
    assert db.add_instrument(conn, "SIE.DE")[1] is False
    run_pending(conn, provider, settings, TODAY)
    before = count(conn, "SELECT COUNT(*) FROM daily_quotes")

    db.enqueue_incremental(conn)
    db.enqueue_incremental(conn)  # segundo pedido ignorado: já existe um pendente
    assert count(conn, "SELECT COUNT(*) FROM fetch_jobs WHERE status = 'queued'") == 1
    run_pending(conn, provider, settings, TODAY)
    assert count(conn, "SELECT COUNT(*) FROM daily_quotes") == before


def test_incremental_update_refetches_overlap_and_applies_corrections(conn, settings):
    provider = FakeProvider()
    db.add_instrument(conn, "TTE.PA")
    run_pending(conn, provider, settings, TODAY - timedelta(days=3))

    corrected = DailyQuote(TODAY - timedelta(days=4), Decimal("50"), Decimal("52"), Decimal("49"),
                           Decimal("51"), Decimal("50.5"), 7)
    provider.overrides["TTE.PA"] = {corrected.session_date: corrected}
    db.enqueue_incremental(conn)
    run_pending(conn, provider, settings, TODAY)

    _, start, _ = provider.calls[-1]
    assert start == TODAY - timedelta(days=3) - timedelta(days=settings.incremental_overlap_days)
    assert instrument(conn, "TTE.PA")["last_session"] == TODAY
    assert count(conn, "SELECT close FROM daily_quotes WHERE session_date = %s", corrected.session_date) == Decimal("51")


def test_non_eur_and_unknown_symbols_become_invalid(conn, settings):
    provider = FakeProvider()
    provider.currency["EQNR.OL"] = "NOK"
    provider.errors["NAOEXISTE.PA"] = "missing"
    db.add_instrument(conn, "EQNR.OL")
    db.add_instrument(conn, "NAOEXISTE.PA")
    run_pending(conn, provider, settings, TODAY)

    assert instrument(conn, "EQNR.OL")["status"] == "invalid"
    assert "NOK" in instrument(conn, "EQNR.OL")["status_reason"]
    assert instrument(conn, "NAOEXISTE.PA")["status"] == "invalid"
    assert count(conn, "SELECT COUNT(*) FROM daily_quotes") == 0


def test_transient_failure_is_retried_and_does_not_block_others(conn, settings):
    provider = FakeProvider()
    provider.errors["SAP.DE"] = "transient"
    db.add_instrument(conn, "SAP.DE")
    db.add_instrument(conn, "ALV.DE")
    run_pending(conn, provider, settings, TODAY)

    assert instrument(conn, "ALV.DE")["status"] == "active"
    assert instrument(conn, "SAP.DE")["status"] == "pending"
    with conn.cursor() as cur:
        cur.execute("SELECT j.status, j.attempts, j.next_attempt_at > NOW(3) AS later FROM fetch_jobs j "
                    "JOIN instruments i ON i.id = j.instrument_id WHERE i.symbol = 'SAP.DE'")
        job = cur.fetchone()
    conn.commit()
    assert job == {"status": "queued", "attempts": 1, "later": 1}


def test_gives_up_after_max_attempts(conn, settings):
    provider = FakeProvider()
    provider.errors["SAP.DE"] = "transient"
    db.add_instrument(conn, "SAP.DE")
    for _ in range(settings.max_attempts):
        with conn.cursor() as cur:
            cur.execute("UPDATE fetch_jobs SET next_attempt_at = NOW(3) WHERE status = 'queued'")
        conn.commit()
        run_pending(conn, provider, settings, TODAY)
    assert count(conn, "SELECT COUNT(*) FROM fetch_jobs WHERE status = 'failed'") == 1


def test_concurrent_workers_never_claim_the_same_job(conn, settings):
    for s in ["ASML.AS", "SIE.DE", "TTE.PA", "SU.PA", "SAN.MC", "SAP.DE"]:
        db.add_instrument(conn, s)
    claimed, lock = [], threading.Lock()

    def worker():
        c = db.connect(settings)
        while (job := db.claim_job(c)) is not None:
            with lock:
                claimed.append(job["id"])
        c.close()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(claimed) == sorted(set(claimed)) and len(claimed) == 6


def test_regista_execucao_da_actualizacao(conn):
    run_id = db.start_run(conn, "fetch_update")
    assert db.failed_jobs_since(conn, run_id) == 0
    db.finish_run(conn, run_id, True, "1 actualizações pedidas")
    with conn.cursor() as cur:
        cur.execute("SELECT status, detail, finished_at FROM job_runs WHERE id = %s", (run_id,))
        row = cur.fetchone()
    assert row["status"] == "done" and row["finished_at"] is not None


def test_actualizacao_horaria_e_registada_a_parte(conn, monkeypatch):
    """`update --intraday` corre como a diária mas fica registada como fetch_intraday."""
    from fetcher import __main__ as cli
    from .conftest import FakeProvider, _settings

    monkeypatch.setattr(cli, "load_settings", _settings)
    monkeypatch.setattr(cli, "YFinanceProvider", FakeProvider)
    db.add_instrument(conn, "ASML.AS")
    assert cli.main(["update"]) == 0
    assert cli.main(["update", "--intraday"]) == 0
    with conn.cursor() as cur:
        cur.execute("SELECT kind, status FROM job_runs ORDER BY id")
        rows = cur.fetchall()
    conn.commit()
    assert [(r["kind"], r["status"]) for r in rows] == [("fetch_update", "done"), ("fetch_intraday", "done")]
