-- migrate:up
-- Vela do próprio dia gravada pela recolha horária, antes do fecho: o motor de alertas só avalia sessões
-- definitivas. A recolha depois do fecho (19:01) grava a mesma sessão por cima, com provisional = FALSE.
ALTER TABLE daily_quotes
  ADD COLUMN provisional BOOLEAN NOT NULL DEFAULT FALSE AFTER volume;

-- migrate:down
ALTER TABLE daily_quotes DROP COLUMN provisional;
