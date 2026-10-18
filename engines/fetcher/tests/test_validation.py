from datetime import date
from decimal import Decimal

from fetcher.models import DailyQuote, InstrumentInfo
from fetcher.validation import instrument_error, normalise_symbol, quote_error, symbol_error


def q(**kw):
    base = dict(session_date=date(2026, 10, 16), open=Decimal("10"), high=Decimal("11"),
                low=Decimal("9"), close=Decimal("10.5"), adj_close=Decimal("10.4"), volume=100)
    base.update(kw)
    return DailyQuote(**base)


def test_symbols_from_initial_list_are_accepted():
    for s in ["ASML.AS", "SIE.DE", "SAN.MC", "NDA-FI.HE", "MUV2.DE", "ABI.BR", "UCG.MI"]:
        assert symbol_error(s) is None, s


def test_bad_symbols_are_rejected():
    for s in ["", "A B", "x" * 40, ".PA"]:
        assert symbol_error(normalise_symbol(s)) is not None, s


def test_only_eur_instruments_are_accepted():
    assert instrument_error(InstrumentInfo("ASML.AS", "EUR", "Amsterdam", "ASML")) is None
    assert "NOK" in instrument_error(InstrumentInfo("EQNR.OL", "NOK", "Oslo", "Equinor"))
    assert instrument_error(InstrumentInfo("X.PA", None, None, None)) is not None


def test_quote_rules():
    assert quote_error(q()) is None
    assert quote_error(q(close=Decimal("0"))) is not None
    assert quote_error(q(high=Decimal("8"))) is not None          # máximo < mínimo
    assert quote_error(q(close=Decimal("12"))) is not None        # fecho fora do intervalo
    assert quote_error(q(open=None, high=None, low=None)) is None  # sessões só com fecho são aceites
