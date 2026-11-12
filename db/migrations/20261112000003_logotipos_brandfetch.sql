-- migrate:up
-- Logotipos dos instrumentos (Brandfetch Logo API): só a chave de cliente. As imagens não se guardam: a Brandfetch exige
-- que sejam mostradas directamente do seu CDN (cdn.brandfetch.io), sem cópias nem pedidos programáticos.
CREATE TABLE logo_settings (
  id         TINYINT UNSIGNED NOT NULL DEFAULT 1,
  provider   VARCHAR(20)      NOT NULL DEFAULT 'brandfetch',
  client_id  VARCHAR(64)      NULL,
  updated_by BIGINT UNSIGNED  NULL,
  updated_at TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT ck_logo_settings_single CHECK (id = 1),
  CONSTRAINT fk_logo_settings_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE logo_settings;
