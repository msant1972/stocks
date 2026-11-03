-- migrate:up
-- Token da SAXO: ambiente (por agora só 'sim'), validade (o token do portal dura 24 h) e marca de recusado (401).
ALTER TABLE user_integration_tokens
  ADD COLUMN environment ENUM('sim','live') NOT NULL DEFAULT 'sim' AFTER token_enc,
  ADD COLUMN expires_at  TIMESTAMP(3) NULL AFTER environment,
  ADD COLUMN rejected_at TIMESTAMP(3) NULL AFTER expires_at;

-- Instrumento da aplicação -> instrumento da SAXO (Uic + AssetType). Preenchida sob pedido, na primeira ordem.
CREATE TABLE saxo_instruments (
  instrument_id BIGINT UNSIGNED NOT NULL,
  environment   ENUM('sim','live') NOT NULL DEFAULT 'sim',
  uic           BIGINT UNSIGNED NOT NULL,
  asset_type    VARCHAR(32)  NOT NULL DEFAULT 'Stock',
  saxo_symbol   VARCHAR(64)  NOT NULL,
  exchange_id   VARCHAR(16)  NULL,
  currency      CHAR(3)      NOT NULL,
  description   VARCHAR(255) NULL,
  tradable      TINYINT(1)   NOT NULL DEFAULT 1,
  order_types   VARCHAR(255) NULL,
  min_size      DECIMAL(18,6) NULL,
  source        ENUM('auto','manual') NOT NULL DEFAULT 'auto',
  resolved_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instrument_id, environment),
  CONSTRAINT fk_saxo_instruments_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ordens enviadas à SAXO pela aplicação. status: sending (a enviar), working (aberta), ended (já não está aberta:
-- executada, expirada ou cancelada fora da aplicação), cancelled, rejected, unknown (resposta perdida: confirmar na SAXO).
CREATE TABLE saxo_orders (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  instrument_id   BIGINT UNSIGNED NOT NULL,
  environment     ENUM('sim','live') NOT NULL DEFAULT 'sim',
  idempotency_key VARCHAR(64)  NOT NULL,
  saxo_order_id   VARCHAR(32)  NULL,
  side            ENUM('buy','sell') NOT NULL,
  quantity        BIGINT UNSIGNED NOT NULL,
  order_type      ENUM('market','limit') NOT NULL,
  limit_price     DECIMAL(18,6) NULL,
  app_price       DECIMAL(18,6) NULL,
  status          ENUM('sending','working','ended','cancelled','rejected','unknown') NOT NULL DEFAULT 'sending',
  message         VARCHAR(500) NULL,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_saxo_orders_key (user_id, idempotency_key),
  KEY ix_saxo_orders_user (user_id, created_at),
  CONSTRAINT fk_saxo_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_saxo_orders_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE saxo_orders;
DROP TABLE saxo_instruments;
ALTER TABLE user_integration_tokens DROP COLUMN rejected_at, DROP COLUMN expires_at, DROP COLUMN environment;
