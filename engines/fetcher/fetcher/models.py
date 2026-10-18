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
