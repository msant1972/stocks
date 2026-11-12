-- migrate:up
-- Interruptor global dos logotipos (Definições → Logotipos): desligado, nenhuma página os mostra, mesmo com Client ID.
ALTER TABLE logo_settings ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER client_id;

-- migrate:down
ALTER TABLE logo_settings DROP COLUMN enabled;
