-- migrate:up
-- Automação (grupo SAXO): sinais das estratégias enviados automaticamente à conta de simulação da SAXO, por utilizador.
-- Interruptor geral, desligado por omissão.
CREATE TABLE saxo_automation_settings (
  user_id    BIGINT UNSIGNED NOT NULL,
  enabled    TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_saxo_auto_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Interruptor por estratégia; sem linha = desligada.
CREATE TABLE saxo_automation_strategies (
  user_id     BIGINT UNSIGNED NOT NULL,
  strategy_id VARCHAR(32) NOT NULL,
  enabled     TINYINT(1) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, strategy_id),
  CONSTRAINT fk_saxo_auto_strategies_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uma linha por sinal tratado: um sinal nunca se envia duas vezes. outcome: pending (a tratar), sent (ordem criada em
-- saxo_orders), skipped (sem ordem, ex.: venda sem posição da automação), failed (recusado antes de chegar à SAXO).
CREATE TABLE saxo_automation_orders (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  strategy_id   VARCHAR(32) NOT NULL,
  instrument_id BIGINT UNSIGNED NOT NULL,
  signal_date   DATE NOT NULL,
  signal_side   ENUM('buy','add','sell') NOT NULL,
  reason        VARCHAR(64) NULL,
  order_id      BIGINT UNSIGNED NULL,
  outcome       ENUM('pending','sent','skipped','failed') NOT NULL DEFAULT 'pending',
  message       VARCHAR(500) NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_saxo_auto_signal (user_id, strategy_id, instrument_id, signal_date, signal_side),
  KEY ix_saxo_auto_user (user_id, created_at),
  CONSTRAINT fk_saxo_auto_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_saxo_auto_orders_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id) ON DELETE CASCADE,
  CONSTRAINT fk_saxo_auto_orders_order FOREIGN KEY (order_id) REFERENCES saxo_orders (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uma execução por utilizador e dia.
CREATE TABLE saxo_automation_runs (
  user_id     BIGINT UNSIGNED NOT NULL,
  run_date    DATE NOT NULL,
  status      ENUM('running','done','failed') NOT NULL DEFAULT 'running',
  counts      TEXT NULL,
  detail      VARCHAR(500) NULL,
  started_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at TIMESTAMP(3) NULL,
  PRIMARY KEY (user_id, run_date),
  CONSTRAINT fk_saxo_auto_runs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE saxo_automation_runs;
DROP TABLE saxo_automation_orders;
DROP TABLE saxo_automation_strategies;
DROP TABLE saxo_automation_settings;
