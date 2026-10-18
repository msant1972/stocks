import os
import pathlib
from datetime import date, timedelta

import pytest

from alerts.config import Settings
from alerts.mailer import SendFailed, SendUncertain
from alerts.service import connect

MIGRATIONS = pathlib.Path(__file__).resolve().parents[3] / "db" / "migrations"


def _settings(**overrides) -> Settings:
    base = dict(
        db_host=os.environ.get("STOCKS_TEST_DB_HOST", "127.0.0.1"),
        db_port=int(os.environ.get("STOCKS_TEST_DB_PORT", "3306")),
        db_user=os.environ.get("STOCKS_TEST_DB_USER", "stocks"),
        db_password=os.environ.get("STOCKS_TEST_DB_PASSWORD", ""),
        db_name=os.environ.get("STOCKS_TEST_DB_NAME", "stocks_test"),
        smtp=None,
        app_url="https://stocks.graus.pt",
    )
    base.update(overrides)
    return Settings(**base)


def _up_statements(path: pathlib.Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    up = text.split("-- migrate:up", 1)[1].split("-- migrate:down", 1)[0]
    lines = [l for l in up.splitlines() if not l.strip().startswith("--")]
    return [s.strip() for s in "\n".join(lines).split(";") if s.strip()]


@pytest.fixture
def settings():
    if "STOCKS_TEST_DB_PASSWORD" not in os.environ:
        pytest.skip("STOCKS_TEST_DB_PASSWORD não definido: testes de base de dados ignorados")
    return _settings()


@pytest.fixture
def conn(settings):
    c = connect(settings)
    with c.cursor() as cur:
        cur.execute("SET FOREIGN_KEY_CHECKS = 0")
        cur.execute("SHOW TABLES")
        for row in cur.fetchall():
            cur.execute(f"DROP TABLE `{next(iter(row.values()))}`")
        cur.execute("SET FOREIGN_KEY_CHECKS = 1")
        for path in sorted(MIGRATIONS.glob("*.sql")):
            for stmt in _up_statements(path):
                cur.execute(stmt)
    c.commit()
    yield c
    c.close()


class FakeMailer:
    def __init__(self):
        self.sent = []
        self.mode = "ok"  # 'ok', 'fail' ou 'uncertain'

    def send(self, msg):
        if self.mode == "fail":
            raise SendFailed("550 recusado")
        if self.mode == "uncertain":
            raise SendUncertain("ligação perdida")
        self.sent.append(msg)


@pytest.fixture
def mailer():
    return FakeMailer()


class Db:
    """Atalhos para preparar dados de teste."""

    def __init__(self, conn):
        self.conn = conn
        self.today = date.today()

    def exec(self, sql, args=()):
        with self.conn.cursor() as cur:
            cur.execute(sql, args)
            last = cur.lastrowid
        self.conn.commit()
        return last

    def one(self, sql, args=()):
        with self.conn.cursor() as cur:
            cur.execute(sql, args)
            row = cur.fetchone()
        self.conn.commit()
        return row

    def user(self, email, disabled=False):
        return self.exec(
            "INSERT INTO users (email, name, password_hash, disabled_at) VALUES (%s, %s, 'x', %s)",
            (email, email.split("@")[0].capitalize(), "2026-01-01" if disabled else None),
        )

    def instrument(self, symbol):
        return self.exec(
            "INSERT INTO instruments (symbol, currency, name, status) VALUES (%s, 'EUR', %s, 'active')",
            (symbol, f"Empresa {symbol}"),
        )

    def quote(self, instrument_id, close, days_ago=0):
        d = self.today - timedelta(days=days_ago)
        self.exec(
            "INSERT INTO daily_quotes (instrument_id, session_date, close, source) VALUES (%s, %s, %s, 'teste') "
            "ON DUPLICATE KEY UPDATE close = VALUES(close)",
            (instrument_id, d, close),
        )
        self.exec(
            "UPDATE instruments SET last_session = (SELECT MAX(session_date) FROM daily_quotes WHERE instrument_id = %s) "
            "WHERE id = %s",
            (instrument_id, instrument_id),
        )
        return d

    def rule(self, user_id, instrument_id, kind, threshold, active=True):
        return self.exec(
            "INSERT INTO alert_rules (user_id, instrument_id, kind, threshold, active) VALUES (%s, %s, %s, %s, %s)",
            (user_id, instrument_id, kind, threshold, active),
        )

    def count(self, table, where="1=1", args=()):
        return self.one(f"SELECT COUNT(*) AS n FROM {table} WHERE {where}", args)["n"]


@pytest.fixture
def db(conn):
    return Db(conn)
