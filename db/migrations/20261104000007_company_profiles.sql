-- migrate:up
-- Perfil da empresa de cada instrumento (fonte: Yahoo, via yfinance): actividade, sector, indicadores e contas anuais.
-- Recolhido pelo motor de recolha (python -m fetcher profiles, semanal, e na carga inicial de cada instrumento).
CREATE TABLE company_profiles (
  instrument_id      BIGINT UNSIGNED NOT NULL,
  status             ENUM('ok','missing') NOT NULL DEFAULT 'ok',
  long_name          VARCHAR(255)  NULL,
  summary            TEXT          NULL,
  sector             VARCHAR(128)  NULL,
  industry           VARCHAR(128)  NULL,
  country            VARCHAR(64)   NULL,
  city               VARCHAR(128)  NULL,
  website            VARCHAR(255)  NULL,
  employees          INT UNSIGNED  NULL,
  currency           CHAR(3)       NULL,
  financial_currency CHAR(3)       NULL,
  market_cap         DECIMAL(24,2) NULL,
  trailing_pe        DECIMAL(18,4) NULL,
  forward_pe         DECIMAL(18,4) NULL,
  price_to_book      DECIMAL(18,4) NULL,
  dividend_yield     DECIMAL(10,4) NULL,  -- em percentagem (3.4 = 3,4 %)
  beta               DECIMAL(10,4) NULL,
  eps                DECIMAL(18,4) NULL,
  profit_margin      DECIMAL(12,6) NULL,  -- fracção (0.0428 = 4,28 %)
  return_on_equity   DECIMAL(12,6) NULL,  -- fracção
  debt_to_equity     DECIMAL(18,4) NULL,  -- em percentagem, como o Yahoo
  high_52w           DECIMAL(18,6) NULL,
  low_52w            DECIMAL(18,6) NULL,
  financials         TEXT          NULL,  -- JSON: [{year, revenue, operatingIncome, netIncome, ebitda}], do mais antigo para o mais recente
  error              VARCHAR(255)  NULL,  -- última falha transitória (os dados anteriores mantêm-se)
  fetched_at         TIMESTAMP(3)  NULL,
  updated_at         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instrument_id),
  CONSTRAINT fk_company_profiles_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE job_runs MODIFY kind ENUM('fetch_update','fetch_intraday','fetch_profiles','alerts') NOT NULL;

-- migrate:down
DELETE FROM job_runs WHERE kind = 'fetch_profiles';
ALTER TABLE job_runs MODIFY kind ENUM('fetch_update','fetch_intraday','alerts') NOT NULL;
DROP TABLE company_profiles;
