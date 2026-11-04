"""Recolha dos perfis das empresas (actividade, sector, indicadores, contas anuais)."""
import logging
import time

from . import db
from .provider import InstrumentNotFound, ProviderError

log = logging.getLogger(__name__)

STALE_DAYS = 7          # um perfil por semana chega: a actividade e as contas mudam pouco
PAUSE_SECONDS = 1.0     # entre instrumentos, para não esbarrar no limite de pedidos do Yahoo


def fetch_one(conn, provider, instrument_id: int, symbol: str) -> str:
    """Recolhe e grava o perfil de um instrumento. Devolve 'ok', 'missing' ou 'failed'."""
    try:
        profile = provider.fetch_profile(symbol)
    except (ProviderError, InstrumentNotFound) as exc:
        log.warning("%s: perfil não recolhido: %s", symbol, exc)
        db.profile_error(conn, instrument_id, str(exc))
        return "failed"
    db.save_profile(conn, instrument_id, profile)
    return "missing" if profile.is_empty() else "ok"


def update_profiles(conn, provider, stale_days: int = STALE_DAYS, limit: int | None = None,
                    pause: float = PAUSE_SECONDS, sleep=time.sleep) -> dict:
    """Recolhe os perfis em falta ou com mais de stale_days dias. Uma falha num instrumento não pára os restantes."""
    counts = {"ok": 0, "missing": 0, "failed": 0}
    rows = db.instruments_needing_profiles(conn, stale_days, limit)
    for n, r in enumerate(rows):
        if n and pause:
            sleep(pause)
        try:
            counts[fetch_one(conn, provider, r["id"], r["symbol"])] += 1
        except Exception:  # erro inesperado (ex.: BD): regista e segue
            log.exception("%s: erro inesperado ao gravar o perfil", r["symbol"])
            conn.rollback()
            counts["failed"] += 1
    return counts
