import os
from dataclasses import dataclass


@dataclass(frozen=True)
class SmtpSettings:
    host: str
    port: int
    user: str | None
    password: str | None
    sender: str
    security: str  # 'starttls', 'ssl' ou 'none'
    timeout: int = 30


@dataclass(frozen=True)
class Settings:
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    smtp: SmtpSettings | None
    app_url: str | None = None
    # Intervalo mínimo entre dois emails ao mesmo utilizador (requisito: no máximo um por hora).
    min_interval_minutes: int = 60
    # Eventos mais antigos do que isto já não são enviados (ex.: após uma paragem prolongada).
    max_event_age_days: int = 7
    # Um envio em 'sending' há mais do que isto foi interrompido; passa a 'uncertain'.
    stale_sending_minutes: int = 30


def load_settings() -> Settings:
    """Lê a configuração de variáveis de ambiente; os segredos nunca ficam no código."""
    env = os.environ
    smtp = None
    if env.get("STOCKS_SMTP_HOST"):
        security = env.get("STOCKS_SMTP_SECURITY", "starttls")
        if security not in ("starttls", "ssl", "none"):
            raise ValueError("STOCKS_SMTP_SECURITY deve ser starttls, ssl ou none")
        smtp = SmtpSettings(
            host=env["STOCKS_SMTP_HOST"],
            port=int(env.get("STOCKS_SMTP_PORT", "465" if security == "ssl" else "587")),
            user=env.get("STOCKS_SMTP_USER") or None,
            password=env.get("STOCKS_SMTP_PASSWORD") or None,
            sender=env["STOCKS_SMTP_FROM"],
            security=security,
        )
    return Settings(
        db_host=env.get("STOCKS_DB_HOST", "127.0.0.1"),
        db_port=int(env.get("STOCKS_DB_PORT", "3306")),
        db_user=env.get("STOCKS_DB_USER", "stocks"),
        db_password=env["STOCKS_DB_PASSWORD"],
        db_name=env.get("STOCKS_DB_NAME", "stocks"),
        smtp=smtp,
        app_url=env.get("STOCKS_PUBLIC_ORIGIN") or None,
        min_interval_minutes=int(env.get("STOCKS_ALERT_MIN_INTERVAL_MINUTES", "60")),
        max_event_age_days=int(env.get("STOCKS_ALERT_MAX_EVENT_AGE_DAYS", "7")),
    )
