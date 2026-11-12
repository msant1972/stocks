-- migrate:up
-- Estratégias ligadas ou desligadas (Definições → Estratégias): global, para todos os módulos. Sem linha = ligada.
CREATE TABLE strategy_settings (
  strategy_id VARCHAR(40)     NOT NULL,
  enabled     TINYINT(1)      NOT NULL DEFAULT 1,
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (strategy_id),
  CONSTRAINT fk_strategy_settings_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE strategy_settings;
