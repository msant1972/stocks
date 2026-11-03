-- migrate:up
-- Alertas SAXO: avisos de que uma ordem já não está aberta na SAXO (executada, expirada ou cancelada fora da aplicação),
-- enviados por email pelo motor de alertas (python -m alerts saxo).
CREATE TABLE saxo_notifications (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  order_id    BIGINT UNSIGNED NOT NULL,
  kind        ENUM('ended') NOT NULL DEFAULT 'ended',
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  emailed_at  TIMESTAMP(3) NULL,
  email_error VARCHAR(255) NULL,
  read_at     TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_saxo_notifications_order (order_id, kind),
  KEY ix_saxo_notifications_user (user_id, created_at),
  CONSTRAINT fk_saxo_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_saxo_notifications_order FOREIGN KEY (order_id) REFERENCES saxo_orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE saxo_alert_settings (
  user_id       BIGINT UNSIGNED NOT NULL,
  email_enabled TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_saxo_alert_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE saxo_alert_settings;
DROP TABLE saxo_notifications;
