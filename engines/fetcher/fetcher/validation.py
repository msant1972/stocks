"""Regras de aceitação de instrumentos e de cotações."""
import re
from decimal import Decimal

from .models import DailyQuote, InstrumentInfo

# A regra é a moeda: aceita-se qualquer bolsa cujo fornecedor indique EUR (Euronext, Xetra, Madrid,
# Helsínquia...). A moeda só é conhecida depois da consulta ao fornecedor, por isso aqui valida-se
# apenas o formato do símbolo Yahoo (ex.: ASML.AS, SIE.DE, NDA-FI.HE).
REQUIRED_CURRENCY = "EUR"
SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-&^=]{0,31}$")


def normalise_symbol(raw: str) -> str:
    return raw.strip().upper()


def symbol_error(symbol: str) -> str | None:
    """Erro de formato do símbolo, ou None se for aceite. Não consulta o fornecedor."""
    if not SYMBOL_RE.match(symbol):
        return "símbolo vazio ou com formato inválido"
    return None


def instrument_error(info: InstrumentInfo) -> str | None:
    """Erro do instrumento devolvido pelo fornecedor, ou None se for aceite."""
    if info.currency != REQUIRED_CURRENCY:
        return f"moeda {info.currency or 'desconhecida'}; só é aceite {REQUIRED_CURRENCY}"
    return None


def quote_error(q: DailyQuote) -> str | None:
    """Erro de uma sessão, ou None se for válida. Sessões inválidas são descartadas, não corrigidas."""
    if q.close <= 0:
        return "fecho não positivo"
    for label, value in (("abertura", q.open), ("máximo", q.high), ("mínimo", q.low)):
        if value is not None and value <= 0:
            return f"{label} não positivo"
    if q.high is not None and q.low is not None:
        if q.high < q.low:
            return "máximo inferior ao mínimo"
        # Tolerância para arredondamentos do fornecedor.
        tol = Decimal("0.0001") * q.high
        if not (q.low - tol <= q.close <= q.high + tol):
            return "fecho fora do intervalo mínimo–máximo"
    if q.volume is not None and q.volume < 0:
        return "volume negativo"
    return None
