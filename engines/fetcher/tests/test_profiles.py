"""Perfis das empresas: conversão do yfinance e recolha semanal."""
import json
from decimal import Decimal

import pandas as pd
import pytest

from fetcher import profiles
from fetcher.models import CompanyProfile
from fetcher.provider import ProviderError, financials_from_income, profile_from_info

INFO = {
    "longName": "Galp Energia, SGPS, S.A.", "longBusinessSummary": "  Galp Energia operates as an integrated energy operator.  ",
    "sector": "Energy", "industry": "Oil & Gas Integrated", "country": "Portugal", "city": "Lisbon", "website": "https://www.galp.com",
    "fullTimeEmployees": 6886, "currency": "EUR", "financialCurrency": "EUR", "marketCap": 14347606016, "trailingPE": 14.078014,
    "forwardPE": 8.913776, "priceToBook": 3.0637443, "dividendYield": 3.4, "beta": -0.067, "trailingEps": 1.41,
    "profitMargins": 0.04278, "returnOnEquity": 0.24595, "debtToEquity": 84.08, "fiftyTwoWeekHigh": 23.18, "fiftyTwoWeekLow": 13.96,
}


def income():
    cols = [pd.Timestamp("2025-12-31"), pd.Timestamp("2024-12-31"), pd.Timestamp("2023-12-31")]
    return pd.DataFrame(
        {cols[0]: [19507e6, 2135e6, 1120e6, 2899e6], cols[1]: [21311e6, 2550e6, 1040e6, float("nan")], cols[2]: [float("nan")] * 4},
        index=["Total Revenue", "Operating Income", "Net Income", "EBITDA"],
    )


class Db:
    """Atalhos mínimos para preparar dados (o conftest do motor de recolha não tem o helper dos alertas)."""

    def __init__(self, conn):
        self.conn = conn

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

    def instrument(self, symbol):
        return self.exec("INSERT INTO instruments (symbol, currency, name, status) VALUES (%s, 'EUR', %s, 'active')", (symbol, symbol))


@pytest.fixture
def db(conn):
    return Db(conn)


def test_converte_o_info_e_as_contas_anuais():
    p = profile_from_info(INFO, income())
    assert p.long_name == "Galp Energia, SGPS, S.A." and p.summary == "Galp Energia operates as an integrated energy operator."
    assert (p.sector, p.industry, p.country, p.employees) == ("Energy", "Oil & Gas Integrated", "Portugal", 6886)
    assert p.market_cap == Decimal("14347606016") and p.dividend_yield == Decimal("3.4") and p.beta == Decimal("-0.067")
    # Do mais antigo para o mais recente; anos sem valores ignorados; valores em falta a None.
    assert p.financials == [
        {"year": 2024, "revenue": 21311e6, "operatingIncome": 2550e6, "netIncome": 1040e6, "ebitda": None},
        {"year": 2025, "revenue": 19507e6, "operatingIncome": 2135e6, "netIncome": 1120e6, "ebitda": 2899e6},
    ]
    assert not p.is_empty()


def test_valores_estranhos_ficam_vazios():
    p = profile_from_info({"marketCap": "n/d", "trailingPE": float("inf"), "beta": True, "fullTimeEmployees": 0, "sector": 3})
    assert (p.market_cap, p.trailing_pe, p.beta, p.employees, p.sector) == (None, None, None, None, None)
    assert p.is_empty()
    assert financials_from_income(None) == [] and financials_from_income(pd.DataFrame()) == []


class FakeProvider:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def fetch_profile(self, symbol):
        self.calls.append(symbol)
        r = self.result(symbol) if callable(self.result) else self.result
        if isinstance(r, Exception):
            raise r
        return r


def test_grava_marca_em_falta_e_mantem_dados_em_falhas_transitorias(conn, db, settings):
    galp, bcp, edp = db.instrument("GALP.LS"), db.instrument("BCP.LS"), db.instrument("EDP.LS")
    db.exec("UPDATE instruments SET status = 'active'")
    results = {"GALP.LS": profile_from_info(INFO, income()), "BCP.LS": CompanyProfile(), "EDP.LS": ProviderError("429")}
    slept = []
    c = profiles.update_profiles(conn, FakeProvider(lambda s: results[s]), sleep=slept.append)
    assert c == {"ok": 1, "missing": 1, "failed": 1}
    assert slept == [1.0, 1.0]
    row = db.one("SELECT * FROM company_profiles WHERE instrument_id = %s", (galp,))
    assert row["status"] == "ok" and row["sector"] == "Energy" and row["fetched_at"] is not None
    assert json.loads(row["financials"])[-1]["year"] == 2025
    assert db.one("SELECT status FROM company_profiles WHERE instrument_id = %s", (bcp,))["status"] == "missing"
    failed = db.one("SELECT status, error, fetched_at FROM company_profiles WHERE instrument_id = %s", (edp,))
    assert failed["error"] == "429" and failed["fetched_at"] is None
    # Na execução seguinte só volta a tentar o que falhou; uma falha transitória não apaga dados anteriores.
    p2 = FakeProvider(ProviderError("rede"))
    profiles.update_profiles(conn, p2, sleep=lambda s: None)
    assert p2.calls == ["EDP.LS"]
    db.exec("UPDATE company_profiles SET fetched_at = NOW(3) - INTERVAL 8 DAY WHERE instrument_id = %s", (galp,))
    profiles.update_profiles(conn, FakeProvider(ProviderError("rede")), sleep=lambda s: None)
    assert db.one("SELECT sector, error FROM company_profiles WHERE instrument_id = %s", (galp,)) == {"sector": "Energy", "error": "rede"}


def test_so_instrumentos_activos(conn, db, settings):
    db.instrument("GALP.LS")
    db.exec("UPDATE instruments SET status = 'invalid'")
    p = FakeProvider(CompanyProfile())
    assert profiles.update_profiles(conn, p, sleep=lambda s: None) == {"ok": 0, "missing": 0, "failed": 0}
    assert p.calls == []


def test_a_carga_inicial_recolhe_logo_o_perfil(conn, settings):
    from datetime import date

    from fetcher import db as fetcher_db
    from fetcher.service import run_pending

    from .conftest import FakeProvider

    class WithProfile(FakeProvider):
        def fetch_profile(self, symbol):
            return profile_from_info(INFO, income())

    fetcher_db.add_instrument(conn, "GALP.LS")
    run_pending(conn, WithProfile(), settings, date(2026, 10, 16))
    with conn.cursor() as cur:
        cur.execute("SELECT p.sector FROM company_profiles p JOIN instruments i ON i.id = p.instrument_id WHERE i.symbol = 'GALP.LS'")
        assert cur.fetchone()["sector"] == "Energy"
    conn.commit()
    # Um fornecedor sem perfis (ou que falha) não estraga a carga inicial.
    fetcher_db.add_instrument(conn, "BCP.LS")
    run_pending(conn, FakeProvider(), settings, date(2026, 10, 16))
    with conn.cursor() as cur:
        cur.execute("SELECT status FROM instruments WHERE symbol = 'BCP.LS'")
        assert cur.fetchone()["status"] == "active"
    conn.commit()
