"""Indicadores técnicos sobre uma série de fechos diários (sem acesso à BD)."""
from decimal import ROUND_HALF_UP, Decimal

# Ordem fixa das colunas em daily_quotes.
SMA_PERIODS = (10, 50, 125, 200)
EMA_PERIOD = 9
COLUMNS = ("ema9", "sma10", "sma50", "sma125", "sma200")

_Q = Decimal("0.000001")


def _round(value: Decimal) -> Decimal:
    return value.quantize(_Q, rounding=ROUND_HALF_UP)


def sma(closes: list[Decimal], period: int) -> list[Decimal | None]:
    """Média móvel simples; None nas primeiras period-1 sessões."""
    out: list[Decimal | None] = []
    window_sum = Decimal(0)
    for i, c in enumerate(closes):
        window_sum += c
        if i >= period:
            window_sum -= closes[i - period]
        out.append(_round(window_sum / period) if i >= period - 1 else None)
    return out


def ema(closes: list[Decimal], period: int) -> list[Decimal | None]:
    """Média móvel exponencial com α = 2/(period+1), iniciada com a SMA das primeiras period sessões.

    O cálculo usa os valores sem arredondar; só o resultado de cada sessão é arredondado.
    """
    out: list[Decimal | None] = []
    alpha = Decimal(2) / Decimal(period + 1)
    current: Decimal | None = None
    for i, c in enumerate(closes):
        if i < period - 1:
            out.append(None)
            continue
        if current is None:
            current = sum(closes[:period], Decimal(0)) / period
        else:
            current = alpha * c + (1 - alpha) * current
        out.append(_round(current))
    return out


def compute(closes: list[Decimal]) -> list[tuple[Decimal | None, ...]]:
    """Para cada sessão, os valores pela ordem de COLUMNS."""
    series = [ema(closes, EMA_PERIOD)] + [sma(closes, p) for p in SMA_PERIODS]
    return list(zip(*series)) if closes else []
