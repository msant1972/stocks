-- migrate:up
-- Data de início escolhida por cada utilizador nas carteiras simuladas (Portfolio Recomendado e Rotação): a carteira começa vazia
-- nesse dia. Fica gravada até ser alterada; sem linha, cada módulo usa o seu período por omissão.
CREATE TABLE portfolio_start_dates (
  user_id    BIGINT UNSIGNED NOT NULL,
  module     VARCHAR(32)     NOT NULL,
  start_date DATE            NOT NULL,
  updated_at TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, module),
  CONSTRAINT fk_portfolio_start_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE portfolio_start_dates;
