"""Garante que o adaptador yfinance distingue falhas transitórias de símbolos inexistentes."""
from datetime import date

import pandas as pd
import pytest
import yfinance as yf
from yfinance.exceptions import YFRateLimitError, YFTickerMissingError

from fetcher.provider import InstrumentNotFound, ProviderError, YFinanceProvider


class FakeTicker:
    behaviour = None

    def __init__(self, symbol):
        self.symbol = symbol
        self.history_metadata = {"currency": "EUR", "fullExchangeName": "Paris", "longName": "TotalEnergies SE"}

    def history(self, **kw):
        b = FakeTicker.behaviour
        if isinstance(b, Exception):
            raise b
        return b


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setattr(yf, "Ticker", FakeTicker)
    return YFinanceProvider()


def fetch(provider):
    return provider.fetch_history("TTE.PA", date(2026, 10, 1), date(2026, 10, 17))


def test_network_error_is_transient(provider):
    FakeTicker.behaviour = ConnectionError("CONNECT tunnel failed")
    with pytest.raises(ProviderError):
        fetch(provider)


def test_rate_limit_is_transient(provider):
    FakeTicker.behaviour = YFRateLimitError()
    with pytest.raises(ProviderError):
        fetch(provider)


def test_empty_answer_is_transient_not_invalid(provider):
    FakeTicker.behaviour = pd.DataFrame()
    with pytest.raises(ProviderError):
        fetch(provider)


def test_missing_ticker_is_not_found(provider):
    FakeTicker.behaviour = YFTickerMissingError("TTE.PA", "no timezone found")
    with pytest.raises(InstrumentNotFound):
        fetch(provider)


def test_rows_are_converted_and_nan_closes_dropped(provider):
    idx = pd.DatetimeIndex(["2026-10-15", "2026-10-16"]).tz_localize("Europe/Paris")
    FakeTicker.behaviour = pd.DataFrame(
        {"Open": [60.0, 61.0], "High": [62.0, 62.0], "Low": [59.0, 60.0], "Close": [61.5, float("nan")],
         "Adj Close": [60.1, float("nan")], "Volume": [1000, 0]}, index=idx)
    h = fetch(provider)
    assert h.info.currency == "EUR" and h.info.name == "TotalEnergies SE"
    assert len(h.quotes) == 1
    assert h.quotes[0].session_date == date(2026, 10, 15) and str(h.quotes[0].close) == "61.5"
