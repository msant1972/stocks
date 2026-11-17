-- migrate:up
-- Interruptor «Mostrar módulo Logotipos» (Definições → Logotipos): mostra ou esconde a entrada «Logotipos» (gestão dos logotipos,
-- administradores) na barra lateral. Escondida, a página continua a abrir pelo endereço e pela ligação do cartão.
ALTER TABLE logo_settings ADD COLUMN show_module TINYINT(1) NOT NULL DEFAULT 1 AFTER enabled;

-- migrate:down
ALTER TABLE logo_settings DROP COLUMN show_module;
