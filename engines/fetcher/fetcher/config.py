import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    history_years: int = 2
    max_attempts: int = 5
    # Dias recolhidos para trás na actualização incremental, para apanhar correcções do fornecedor.
    incremental_overlap_days: int = 7


def load_settings() -> Settings:
    """Lê a configuração de variáveis de ambiente; os segredos nunca ficam no código."""
    return Settings(
        db_host=os.environ.get("STOCKS_DB_HOST", "127.0.0.1"),
        db_port=int(os.environ.get("STOCKS_DB_PORT", "3306")),
        db_user=os.environ.get("STOCKS_DB_USER", "stocks"),
        db_password=os.environ["STOCKS_DB_PASSWORD"],
        db_name=os.environ.get("STOCKS_DB_NAME", "stocks"),
        history_years=int(os.environ.get("STOCKS_HISTORY_YEARS", "2")),
        max_attempts=int(os.environ.get("STOCKS_FETCH_MAX_ATTEMPTS", "5")),
    )
