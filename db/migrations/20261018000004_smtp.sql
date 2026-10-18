-- migrate:up

-- Configuração SMTP global, editada pelos administradores em Definições e usada pelo motor de alertas.
-- Uma só linha (id = 1). A palavra-passe fica cifrada com AES-256-GCM (formato "v1:" + base64 de
-- iv | tag | texto cifrado), com a chave em /etc/stocks/secret.key; nunca é devolvida pela API.
CREATE TABLE smtp_settings (
  id            TINYINT UNSIGNED NOT NULL,
  host          VARCHAR(255)    NOT NULL,
  port          SMALLINT UNSIGNED NOT NULL,
  security      ENUM('starttls','ssl','none') NOT NULL DEFAULT 'starttls',
  username      VARCHAR(255)    NULL,
  password_enc  TEXT            NULL,
  sender        VARCHAR(255)    NOT NULL,
  updated_by    BIGINT UNSIGNED NULL,
  updated_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT ck_smtp_single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE smtp_settings;
