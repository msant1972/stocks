"""Adaptador do fornecedor de cotações.

O resto do motor depende apenas de QuoteProvider, para que o yfinance possa ser
substituído por um fornecedor licenciado sem alterar a lógica de recolha.
"""
import math
from datetime import date
from decimal import Decimal
from typing import Protocol

from .models import CompanyProfile, DailyQuote, History, InstrumentInfo


class ProviderError(Exception):
    """Falha transitória (rede, limite de pedidos): o pedido deve ser repetido mais tarde."""


class InstrumentNotFound(Exception):
    """O fornecedor não reconhece o símbolo ou não devolve dados: não vale a pena repetir."""


class QuoteProvider(Protocol):
    name: str

    def fetch_history(self, symbol: str, start: date, end: date) -> History:
        """Devolve as sessões diárias em [start, end) e a informação do instrumento."""
        ...


def _dec(value) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if not isinstance(value, (int, float, Decimal)):
        try:
            value = float(value)
        except (TypeError, ValueError):
            return None
        if math.isnan(value) or math.isinf(value):
            return None
    return Decimal(str(value))


def _text(value, limit: int) -> str | None:
    return (value.strip()[:limit] or None) if isinstance(value, str) else None


# Linhas da demonstração de resultados anual (yfinance income_stmt) e a chave usada na aplicação.
FINANCIAL_ROWS = {"Total Revenue": "revenue", "Operating Income": "operatingIncome", "Net Income": "netIncome", "EBITDA": "ebitda"}


def financials_from_income(income) -> list[dict]:
    """Contas anuais (receitas, resultado operacional, resultado líquido, EBITDA) do mais antigo para o mais recente.
    Anos sem nenhum valor são ignorados; valores em falta ficam None."""
    if income is None or getattr(income, "empty", True):
        return []
    out = []
    for col in income.columns:
        year = getattr(col, "year", None)
        if year is None:
            continue
        row = {"year": int(year)}
        for label, key in FINANCIAL_ROWS.items():
            v = _dec(income.loc[label, col]) if label in income.index else None
            row[key] = None if v is None else float(v)
        if any(row[k] is not None for k in FINANCIAL_ROWS.values()):
            out.append(row)
    return sorted(out, key=lambda r: r["year"])


def profile_from_info(info: dict, income=None) -> CompanyProfile:
    """Converte o `info` do yfinance (e a demonstração de resultados anual) num CompanyProfile."""
    info = info or {}
    employees = info.get("fullTimeEmployees")
    return CompanyProfile(
        long_name=_text(info.get("longName") or info.get("shortName"), 255),
        summary=_text(info.get("longBusinessSummary"), 6000),
        sector=_text(info.get("sector"), 128),
        industry=_text(info.get("industry"), 128),
        country=_text(info.get("country"), 64),
        city=_text(info.get("city"), 128),
        website=_text(info.get("website"), 255),
        employees=int(employees) if isinstance(employees, (int, float)) and employees > 0 else None,
        currency=_text(info.get("currency"), 3),
        financial_currency=_text(info.get("financialCurrency"), 3),
        market_cap=_dec(info.get("marketCap")),
        trailing_pe=_dec(info.get("trailingPE")),
        forward_pe=_dec(info.get("forwardPE")),
        price_to_book=_dec(info.get("priceToBook")),
        dividend_yield=_dec(info.get("dividendYield")),
        beta=_dec(info.get("beta")),
        eps=_dec(info.get("trailingEps")),
        profit_margin=_dec(info.get("profitMargins")),
        return_on_equity=_dec(info.get("returnOnEquity")),
        debt_to_equity=_dec(info.get("debtToEquity")),
        high_52w=_dec(info.get("fiftyTwoWeekHigh")),
        low_52w=_dec(info.get("fiftyTwoWeekLow")),
        financials=financials_from_income(income),
    )


class YFinanceProvider:
    name = "yfinance"

    def fetch_history(self, symbol: str, start: date, end: date) -> History:
        import yfinance as yf
        from yfinance.exceptions import YFPricesMissingError, YFTickerMissingError

        # Por omissão o yfinance esconde as excepções e devolve uma tabela vazia, o que tornaria uma
        # falha de rede indistinguível de um símbolo inexistente (e invalidaria instrumentos bons).
        yf.config.debug.hide_exceptions = False

        ticker = yf.Ticker(symbol)
        try:
            # auto_adjust=False: Close fica não ajustado e Adj Close vem numa coluna à parte.
            df = ticker.history(start=start, end=end, interval="1d", auto_adjust=False, actions=False)
            meta = ticker.history_metadata or {}
        except (YFTickerMissingError, YFPricesMissingError) as exc:
            raise InstrumentNotFound(str(exc)) from exc
        except Exception as exc:  # rede, limite de pedidos (YFRateLimitError), respostas inesperadas
            raise ProviderError(f"{type(exc).__name__}: {exc}") from exc

        if df is None or df.empty:
            # Sem excepção e sem dados: tratado como transitório, para nunca invalidar por engano.
            raise ProviderError(f"resposta vazia para {symbol}")

        info = InstrumentInfo(
            symbol=symbol,
            currency=meta.get("currency"),
            exchange=meta.get("fullExchangeName") or meta.get("exchangeName"),
            name=meta.get("longName") or meta.get("shortName"),
        )
        quotes = []
        for ts, row in df.iterrows():
            close = _dec(row.get("Close"))
            if close is None:
                continue
            volume = row.get("Volume")
            quotes.append(
                DailyQuote(
                    session_date=ts.date(),
                    open=_dec(row.get("Open")),
                    high=_dec(row.get("High")),
                    low=_dec(row.get("Low")),
                    close=close,
                    adj_close=_dec(row.get("Adj Close")),
                    volume=None if volume is None or (isinstance(volume, float) and math.isnan(volume)) else int(volume),
                )
            )
        return History(info=info, quotes=quotes)

    def fetch_profile(self, symbol: str) -> CompanyProfile:
        """Perfil da empresa. ProviderError em falhas de rede ou limite de pedidos; perfil vazio se o Yahoo não o tiver."""
        import yfinance as yf

        yf.config.debug.hide_exceptions = False
        ticker = yf.Ticker(symbol)
        try:
            info = ticker.info or {}
        except Exception as exc:  # rede, limite de pedidos, respostas inesperadas
            raise ProviderError(f"{type(exc).__name__}: {exc}") from exc
        try:
            income = ticker.income_stmt
        except Exception:  # as contas são opcionais: sem elas, o resto do perfil serve
            income = None
        return profile_from_info(info, income)
