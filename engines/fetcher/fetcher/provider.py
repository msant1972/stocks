"""Adaptador do fornecedor de cotações.

O resto do motor depende apenas de QuoteProvider, para que o yfinance possa ser
substituído por um fornecedor licenciado sem alterar a lógica de recolha.
"""
import math
from datetime import date
from decimal import Decimal
from typing import Protocol

from .models import DailyQuote, History, InstrumentInfo


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
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return Decimal(str(value))


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
