import os
import pathlib
from datetime import date, timedelta
from decimal import Decimal

import pytest

from fetcher import db
from fetcher.config import Settings
from fetcher.models import DailyQuote, History, InstrumentInfo
from fetcher.provider import InstrumentNotFound, ProviderError

MIGRATIONS = pathlib.Path(__file__).resolve().parents[3] / "db" / "migrations"


def _settings() -> Settings:
    return Settings(
        db_host=os.environ.get("STOCKS_TEST_DB_HOST", "127.0.0.1"),
        db_port=int(os.environ.get("STOCKS_TEST_DB_PORT", "3306")),
        db_user=os.environ.get("STOCKS_TEST_DB_USER", "stocks"),
        db_password=os.environ.get("STOCKS_TEST_DB_PASSWORD", ""),
        db_name=os.environ.get("STOCKS_TEST_DB_NAME", "stocks_test"),
    )


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
    c = db.connect(settings)
    with c.cursor() as cur:
        for table in ("fetch_jobs", "daily_quotes", "instruments"):
            cur.execute(f"DROP TABLE IF EXISTS {table}")
        for path in sorted(MIGRATIONS.glob("*.sql")):
            for stmt in _up_statements(path):
                cur.execute(stmt)
    c.commit()
    yield c
    c.close()


def make_sessions(start: date, end: date, base: str = "100") -> list[DailyQuote]:
    """Sessões de segunda a sexta, sem feriados, com preços sintéticos."""
    out, d, price = [], start, Decimal(base)
    while d < end:
        if d.weekday() < 5:
            out.append(DailyQuote(d, price, price + 1, price - 1, price, price - Decimal("0.5"), 1000))
            price += Decimal("0.1")
        d += timedelta(days=1)
    return out


class FakeProvider:
    """Fornecedor em memória: cada símbolo tem moeda e comportamento configuráveis."""

    name = "fake"

    def __init__(self):
        self.currency = {}
        self.errors = {}
        self.overrides = {}
        self.calls = []

    def fetch_history(self, symbol, start, end):
        self.calls.append((symbol, start, end))
        err = self.errors.get(symbol)
        if err == "missing":
            raise InstrumentNotFound(f"sem dados para {symbol}")
        if err == "transient":
            raise ProviderError("429 Too Many Requests")
        quotes = [q for q in make_sessions(start, end) if q.session_date not in self.overrides.get(symbol, {})]
        quotes += [q for q in self.overrides.get(symbol, {}).values() if start <= q.session_date < end]
        info = InstrumentInfo(symbol, self.currency.get(symbol, "EUR"), "Teste", f"Empresa {symbol}")
        return History(info=info, quotes=sorted(quotes, key=lambda q: q.session_date))
