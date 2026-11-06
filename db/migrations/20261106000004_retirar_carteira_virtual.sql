-- migrate:up
-- A carteira virtual foi retirada (decisão do utilizador, 6 nov. 2026): a aplicação usa a carteira da conta de simulação da SAXO.
-- Os dados da carteira virtual são apagados.
DROP TABLE cash_movements;
DROP TABLE positions;
DROP TABLE simulated_trades;
DROP TABLE portfolios;

-- Valor da conta SAXO no fim de cada sessão: é a base do gráfico da evolução da carteira.
CREATE TABLE saxo_account_history (
  user_id         BIGINT UNSIGNED NOT NULL,
  environment     ENUM('sim','live') NOT NULL DEFAULT 'sim',
  session_date    DATE NOT NULL,
  total_value     DECIMAL(18,2) NOT NULL,
  cash_balance    DECIMAL(18,2) NULL,
  positions_value DECIMAL(18,2) NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'EUR',
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, environment, session_date),
  CONSTRAINT fk_saxo_account_history_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
-- Recria as tabelas vazias: os dados apagados não voltam (estão nas cópias de /var/backups/stocks durante 30 dias).
DROP TABLE saxo_account_history;
CREATE TABLE portfolios (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  currency        CHAR(3)         NOT NULL DEFAULT 'EUR',
  initial_capital DECIMAL(18,2)   NOT NULL,
  cash_balance    DECIMAL(18,2)   NOT NULL,
  created_at      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_portfolios_user (user_id),
  CONSTRAINT fk_portfolios_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_portfolios_cash CHECK (cash_balance >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Operações simuladas. Preço, moeda e data da cotação ficam registados na própria operação.
-- price é o fecho não ajustado; amount = ROUND(quantity * price, 2).
CREATE TABLE simulated_trades (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  portfolio_id    BIGINT UNSIGNED NOT NULL,
  instrument_id   BIGINT UNSIGNED NOT NULL,
  side            ENUM('buy','sell') NOT NULL,
  quantity        INT UNSIGNED    NOT NULL,
  price           DECIMAL(18,6)   NOT NULL,
  amount          DECIMAL(18,2)   NOT NULL,
  currency        CHAR(3)         NOT NULL,
  quote_date      DATE            NOT NULL,
  realized_pnl    DECIMAL(18,2)   NULL,              -- só nas vendas: valor da venda menos custo retirado
  idempotency_key VARCHAR(64)     NOT NULL,
  requested_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_trades_idempotency (portfolio_id, idempotency_key),
  KEY ix_trades_portfolio (portfolio_id, requested_at),
  CONSTRAINT fk_trades_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE,
  CONSTRAINT fk_trades_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id),
  CONSTRAINT ck_trades_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Movimentos de saldo: capital inicial e contrapartida de cada operação (amount com sinal).
CREATE TABLE cash_movements (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  portfolio_id  BIGINT UNSIGNED NOT NULL,
  kind          ENUM('initial','buy','sell') NOT NULL,
  amount        DECIMAL(18,2)   NOT NULL,
  trade_id      BIGINT UNSIGNED NULL,
  created_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_cash_portfolio (portfolio_id),
  CONSTRAINT fk_cash_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE,
  CONSTRAINT fk_cash_trade FOREIGN KEY (trade_id) REFERENCES simulated_trades (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Posição actual por instrumento. Guarda-se o custo total das unidades detidas (custo médio ponderado);
-- o custo médio é cost_basis / quantity, calculado na leitura, para não acumular arredondamentos.
CREATE TABLE positions (
  portfolio_id  BIGINT UNSIGNED NOT NULL,
  instrument_id BIGINT UNSIGNED NOT NULL,
  quantity      INT UNSIGNED    NOT NULL,
  cost_basis    DECIMAL(18,2)   NOT NULL,
  realized_pnl  DECIMAL(18,2)   NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (portfolio_id, instrument_id),
  CONSTRAINT fk_positions_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE,
  CONSTRAINT fk_positions_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
