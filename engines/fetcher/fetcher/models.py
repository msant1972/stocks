from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal


@dataclass(frozen=True)
class DailyQuote:
    session_date: date
    open: Decimal | None
    high: Decimal | None
    low: Decimal | None
    close: Decimal
    adj_close: Decimal | None
    volume: int | None


@dataclass(frozen=True)
class InstrumentInfo:
    symbol: str
    currency: str | None
    exchange: str | None
    name: str | None


@dataclass
class History:
    info: InstrumentInfo
    quotes: list[DailyQuote] = field(default_factory=list)


@dataclass
class CompanyProfile:
    """Perfil da empresa (fonte: Yahoo). Todos os campos podem faltar."""
    long_name: str | None = None
    summary: str | None = None
    sector: str | None = None
    industry: str | None = None
    country: str | None = None
    city: str | None = None
    website: str | None = None
    employees: int | None = None
    currency: str | None = None
    financial_currency: str | None = None
    market_cap: Decimal | None = None
    trailing_pe: Decimal | None = None
    forward_pe: Decimal | None = None
    price_to_book: Decimal | None = None
    dividend_yield: Decimal | None = None
    beta: Decimal | None = None
    eps: Decimal | None = None
    profit_margin: Decimal | None = None
    return_on_equity: Decimal | None = None
    debt_to_equity: Decimal | None = None
    high_52w: Decimal | None = None
    low_52w: Decimal | None = None
    financials: list[dict] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not (self.summary or self.sector or self.market_cap or self.financials)
