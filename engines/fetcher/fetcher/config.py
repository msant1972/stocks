import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    # Sete anos (desde 17 nov. 2026; eram cinco): os dois anos dos gráficos e do BackTest, os dois do período de verificação, o
    # aquecimento das médias (a SMA200 precisa de 200 sessões) e o mercado em queda de 2022 e a queda de 2020 para os estudos;
    # o Charts mostra até cinco anos (período 5A).
    history_years: int = 7
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
        history_years=int(os.environ.get("STOCKS_HISTORY_YEARS", "7")),
        max_attempts=int(os.environ.get("STOCKS_FETCH_MAX_ATTEMPTS", "5")),
    )
