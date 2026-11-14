-- migrate:up
-- Limites de segurança da Automação (por utilizador; NULL = sem limite):
--  max_positions: teto de instrumentos com posição na conta; com o teto atingido, as compras de instrumentos novos não se enviam
--                 (os reforços de posições que já existem continuam a poder fazer-se);
--  max_drawdown_pct: interruptor de perda máxima: com o valor da conta mais de X % abaixo do seu máximo, não se envia nenhuma
--                 compra nem reforço (as vendas continuam a sair).
ALTER TABLE saxo_automation_settings
  ADD COLUMN max_positions    SMALLINT UNSIGNED NULL AFTER enabled,
  ADD COLUMN max_drawdown_pct TINYINT UNSIGNED  NULL AFTER max_positions;

-- migrate:down
ALTER TABLE saxo_automation_settings DROP COLUMN max_drawdown_pct, DROP COLUMN max_positions;
