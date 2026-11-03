-- migrate:up
-- Tokens de acesso de cada utilizador a serviços externos (hoje só a SAXO Bank, provider = 'saxo'), cifrados com a
-- chave do servidor (AES-256-GCM, /etc/stocks/secret.key) como a palavra-passe SMTP. Nunca são devolvidos pela API.
CREATE TABLE user_integration_tokens (
  user_id    BIGINT UNSIGNED NOT NULL,
  provider   VARCHAR(32)     NOT NULL,
  token_enc  TEXT            NOT NULL,
  updated_at TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, provider),
  CONSTRAINT fk_integration_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE user_integration_tokens;
