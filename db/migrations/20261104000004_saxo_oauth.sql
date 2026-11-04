-- migrate:up
-- Aplicação SAXO de cada utilizador (chave e segredo, este cifrado) para o fluxo OAuth «Authorization Code»; e, no token,
-- o tipo de ligação (manual: token de 24 h colado; oauth: access token renovado com o refresh token, de uso único).
CREATE TABLE user_saxo_apps (
  user_id        BIGINT UNSIGNED NOT NULL,
  app_key        VARCHAR(64)  NOT NULL,
  app_secret_enc TEXT         NOT NULL,
  updated_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_saxo_apps_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE user_integration_tokens
  ADD COLUMN auth_kind ENUM('manual','oauth') NOT NULL DEFAULT 'manual' AFTER environment,
  ADD COLUMN refresh_token_enc TEXT NULL AFTER auth_kind,
  ADD COLUMN refresh_expires_at TIMESTAMP(3) NULL AFTER refresh_token_enc;

-- migrate:down
ALTER TABLE user_integration_tokens DROP COLUMN refresh_expires_at, DROP COLUMN refresh_token_enc, DROP COLUMN auth_kind;
DROP TABLE user_saxo_apps;
