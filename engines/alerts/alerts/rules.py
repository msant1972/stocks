"""Avaliação das regras sobre o fecho diário (sem acesso à BD)."""
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal


@dataclass(frozen=True)
class Evaluation:
    state: bool                 # a condição verifica-se nesta sessão
    fire: bool                  # gera um evento
    change_pct: Decimal | None  # variação face à sessão anterior, com 4 casas


def change_pct(close: Decimal, previous: Decimal | None) -> Decimal | None:
    if previous is None or previous == 0:
        return None
    return ((close - previous) * 100 / previous).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def evaluate(kind: str, threshold: Decimal, close: Decimal, previous: Decimal | None,
             last_state: bool | None) -> Evaluation:
    """
    close_above / close_below: dispara quando a condição passa a verificar-se (last_state não era
    verdadeiro). Assim, um fecho que se mantém acima do limite durante semanas gera um só alerta.
    change_up / change_down: variação face à sessão anterior, avaliada em cada sessão; sem sessão
    anterior não há variação e a regra não dispara.
    """
    pct = change_pct(close, previous)
    if kind == "close_above":
        state = close > threshold
        return Evaluation(state, state and last_state is not True, pct)
    if kind == "close_below":
        state = close < threshold
        return Evaluation(state, state and last_state is not True, pct)
    if kind == "change_up":
        state = pct is not None and pct >= threshold
        return Evaluation(state, state, pct)
    if kind == "change_down":
        state = pct is not None and pct <= -threshold
        return Evaluation(state, state, pct)
    raise ValueError(f"tipo de regra desconhecido: {kind}")
