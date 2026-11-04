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


# Linhas das contas anuais do yfinance e a chave usada na aplicação: demonstração de resultados (income_stmt),
# fluxos de caixa (cashflow) e balanço (balance_sheet). Só as linhas da demonstração de resultados decidem se um ano conta.
FINANCIAL_ROWS = {"Total Revenue": "revenue", "Operating Income": "operatingIncome", "Net Income": "netIncome", "EBITDA": "ebitda"}
EXTRA_INCOME_ROWS = {"Diluted EPS": "dilutedEps"}
CASHFLOW_ROWS = {"Free Cash Flow": "freeCashFlow"}
BALANCE_ROWS = {"Stockholders Equity": "equity", "Ordinary Shares Number": "shares"}


def _rows_by_year(frame, rows: dict) -> dict:
    """{ano: {chave: valor}} para as linhas pedidas de uma tabela anual do yfinance (colunas = datas de fecho)."""
    out: dict = {}
    if frame is None or getattr(frame, "empty", True):
        return out
    for col in frame.columns:
        year = getattr(col, "year", None)
        if year is None:
            continue
        vals = out.setdefault(int(year), {})
        for label, key in rows.items():
            v = _dec(frame.loc[label, col]) if label in frame.index else None
            vals[key] = None if v is None else float(v)
    return out


def financials_from_income(income, cashflow=None, balance=None) -> list[dict]:
    """Contas anuais do mais antigo para o mais recente: receitas, resultado operacional, resultado líquido, EBITDA,
    resultado diluído por acção, fluxo de caixa livre, capitais próprios e número de acções.
    Anos sem nenhum valor da demonstração de resultados são ignorados; valores em falta ficam None."""
    inc = _rows_by_year(income, {**FINANCIAL_ROWS, **EXTRA_INCOME_ROWS})
    cf = _rows_by_year(cashflow, CASHFLOW_ROWS)
    bs = _rows_by_year(balance, BALANCE_ROWS)
    out = []
    for year, vals in inc.items():
        if not any(vals[k] is not None for k in FINANCIAL_ROWS.values()):
            continue
        row = {"year": year, **{k: vals[k] for k in FINANCIAL_ROWS.values()}, "dilutedEps": vals["dilutedEps"]}
        row.update({k: cf.get(year, {}).get(k) for k in CASHFLOW_ROWS.values()})
        row.update({k: bs.get(year, {}).get(k) for k in BALANCE_ROWS.values()})
        out.append(row)
    return sorted(out, key=lambda r: r["year"])


_RECOMMENDATIONS = {"strong_buy", "buy", "hold", "underperform", "sell", "strong_sell", "none"}


def _count(value) -> int | None:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0 else None


def profile_from_info(info: dict, income=None, cashflow=None, balance=None) -> CompanyProfile:
    """Converte o `info` do yfinance (e as contas anuais) num CompanyProfile."""
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
        ref_price=_dec(info.get("currentPrice") or info.get("regularMarketPrice")),
        enterprise_value=_dec(info.get("enterpriseValue")),
        enterprise_to_ebitda=_dec(info.get("enterpriseToEbitda")),
        ebitda=_dec(info.get("ebitda")),
        total_debt=_dec(info.get("totalDebt")),
        total_cash=_dec(info.get("totalCash")),
        shares_outstanding=_count(info.get("sharesOutstanding")),
        free_cashflow=_dec(info.get("freeCashflow")),
        book_value=_dec(info.get("bookValue")),
        forward_eps=_dec(info.get("forwardEps")),
        earnings_growth=_dec(info.get("earningsGrowth")),
        revenue_growth=_dec(info.get("revenueGrowth")),
        payout_ratio=_dec(info.get("payoutRatio")),
        target_mean=_dec(info.get("targetMeanPrice")),
        target_median=_dec(info.get("targetMedianPrice")),
        target_low=_dec(info.get("targetLowPrice")),
        target_high=_dec(info.get("targetHighPrice")),
        analyst_count=_count(info.get("numberOfAnalystOpinions")),
        recommendation_key=rec if (rec := _text(info.get("recommendationKey"), 16)) in _RECOMMENDATIONS else None,
        recommendation_mean=_dec(info.get("recommendationMean")),
        financials=financials_from_income(income, cashflow, balance),
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
        return profile_from_info(info, *(_optional(ticker, name) for name in ("income_stmt", "cashflow", "balance_sheet")))


def _optional(ticker, name):
    """As contas anuais são opcionais: se o Yahoo falhar numa delas, o resto do perfil serve."""
    try:
        return getattr(ticker, name)
    except Exception:
        return None
