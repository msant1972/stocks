-- migrate:up
-- Alertas de sinais: uma regra «signal» avisa quando a estratégia indicada (registo shared/strategies) dá um sinal
-- de compra, reforço ou venda no instrumento, numa sessão definitiva. Não tem limite (threshold NULL).
ALTER TABLE alert_rules
  MODIFY kind ENUM('close_above','close_below','change_up','change_down','signal') NOT NULL,
  MODIFY threshold DECIMAL(18,6) NULL,
  ADD COLUMN strategy VARCHAR(32) NULL AFTER threshold;
ALTER TABLE alert_events
  ADD COLUMN signal_side ENUM('buy','add','sell') NULL AFTER change_pct;

-- migrate:down
DELETE FROM alert_rules WHERE kind = 'signal';
ALTER TABLE alert_events DROP COLUMN signal_side;
ALTER TABLE alert_rules
  DROP COLUMN strategy,
  MODIFY threshold DECIMAL(18,6) NOT NULL,
  MODIFY kind ENUM('close_above','close_below','change_up','change_down') NOT NULL;
