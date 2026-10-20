-- migrate:up

-- Segundo factor de autenticação (TOTP, RFC 6238), obrigatório para todos os utilizadores.
-- Os segredos ficam cifrados com a chave do servidor (/etc/stocks/secret.key), como a palavra-passe SMTP.
ALTER TABLE users
  ADD COLUMN totp_secret_enc  TEXT         NULL AFTER password_hash,  -- segredo activo
  ADD COLUMN totp_pending_enc TEXT         NULL AFTER totp_secret_enc, -- segredo em configuração (ainda não confirmado)
  ADD COLUMN totp_enabled_at  TIMESTAMP(3) NULL AFTER totp_pending_enc,
  ADD COLUMN totp_last_step   BIGINT       NULL AFTER totp_enabled_at; -- último passo de 30 s usado (impede reutilizar o código)

-- Sessões em dois passos: depois da palavra-passe a sessão fica restrita ao segundo factor
-- ('mfa_setup' ou 'mfa_verify', curta) e só passa a 'full' depois do código TOTP.
ALTER TABLE sessions
  ADD COLUMN stage        ENUM('mfa_setup','mfa_verify','full') NOT NULL DEFAULT 'full' AFTER user_id,
  ADD COLUMN mfa_failures TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER stage;

-- Códigos de recuperação de uso único (só o SHA-256 é guardado).
CREATE TABLE user_recovery_codes (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  code_hash  CHAR(64)        NOT NULL,
  used_at    TIMESTAMP(3)    NULL,
  created_at TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_recovery_code (user_id, code_hash),
  CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE user_recovery_codes;
ALTER TABLE sessions DROP COLUMN stage, DROP COLUMN mfa_failures;
ALTER TABLE users DROP COLUMN totp_secret_enc, DROP COLUMN totp_pending_enc, DROP COLUMN totp_enabled_at, DROP COLUMN totp_last_step;
