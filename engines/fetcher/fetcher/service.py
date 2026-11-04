"""Processamento dos pedidos de recolha."""
import logging
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from . import db, profiles
from .config import Settings
from .provider import InstrumentNotFound, ProviderError, QuoteProvider
from .validation import instrument_error, quote_error

log = logging.getLogger(__name__)

# Até esta hora de Lisboa a vela do próprio dia é provisória: as bolsas europeias fecham às 16:30 de Lisboa
# (17:30 CET) e o Yahoo tem cerca de 20 minutos de atraso. A recolha das 19:01 grava o fecho definitivo.
MARKET_TZ = ZoneInfo("Europe/Lisbon")
FINAL_AFTER = time(18, 0)


def provisional_session(today: date, now: datetime) -> date | None:
    """Sessão cuja vela ainda é provisória (a de hoje, antes de FINAL_AFTER), ou None."""
    local = now.astimezone(MARKET_TZ)
    return today if local.date() == today and local.time() < FINAL_AFTER else None


def retry_delay_minutes(attempts: int) -> int:
    """Espera progressiva: 2, 4, 8, 16... minutos, com tecto de 2 horas."""
    return min(2 ** attempts, 120)


def process_job(conn, provider: QuoteProvider, settings: Settings, job: dict, today: date,
                now: datetime | None = None) -> None:
    symbol = job["symbol"]
    initial = job["kind"] == "initial" or job["last_session"] is None
    if initial:
        start = db.history_start(today, settings.history_years)
    else:
        start = job["last_session"] - timedelta(days=settings.incremental_overlap_days)
    end = today + timedelta(days=1)

    try:
        history = provider.fetch_history(symbol, start, end)
    except InstrumentNotFound as exc:
        log.warning("%s: %s", symbol, exc)
        # Só a carga inicial invalida o instrumento; numa actualização pode ser uma falha pontual.
        invalidate = job["instrument_id"] if job["instrument_status"] == "pending" else None
        db.fail_job(conn, job["id"], f"símbolo não encontrado no fornecedor: {exc}", None, invalidate)
        return
    except ProviderError as exc:
        retry = retry_delay_minutes(job["attempts"]) if job["attempts"] < settings.max_attempts else None
        log.warning("%s: falha do fornecedor (tentativa %s): %s", symbol, job["attempts"], exc)
        db.fail_job(conn, job["id"], str(exc), retry)
        return

    if job["instrument_status"] == "pending":
        err = instrument_error(history.info)
        if err:
            db.fail_job(conn, job["id"], err, None, job["instrument_id"])
            return
        info = history.info
    else:
        info = None

    valid, rejected = [], []
    for q in history.quotes:
        (rejected if quote_error(q) else valid).append(q)
    note = None
    if rejected:
        note = f"{len(rejected)} sessões descartadas na validação"
        log.warning("%s: %s", symbol, note)

    provisional = provisional_session(today, now or datetime.now(MARKET_TZ))
    written = db.complete_job(conn, job["id"], job["instrument_id"], info, valid, provider.name, note, provisional)
    log.info("%s: %s sessões gravadas (%s)", symbol, written, job["kind"])
    # Instrumento novo: recolhe já o perfil da empresa (melhor esforço; o comando semanal completa o que falhar).
    if job["instrument_status"] == "pending" and hasattr(provider, "fetch_profile"):
        try:
            profiles.fetch_one(conn, provider, job["instrument_id"], symbol)
        except Exception:
            log.exception("%s: perfil não recolhido na carga inicial", symbol)
            conn.rollback()


def run_pending(conn, provider: QuoteProvider, settings: Settings, today: date | None = None,
                now: datetime | None = None) -> int:
    """Processa pedidos até a fila ficar vazia. Uma falha num instrumento não pára os restantes."""
    today = today or date.today()
    db.requeue_stale_jobs(conn)
    processed = 0
    while (job := db.claim_job(conn)) is not None:
        try:
            process_job(conn, provider, settings, job, today, now)
        except Exception as exc:  # erro inesperado (ex.: BD): regista e segue para o próximo
            log.exception("%s: erro inesperado", job["symbol"])
            conn.rollback()
            retry = retry_delay_minutes(job["attempts"]) if job["attempts"] < settings.max_attempts else None
            db.fail_job(conn, job["id"], f"erro inesperado: {exc}", retry)
        processed += 1
    return processed
