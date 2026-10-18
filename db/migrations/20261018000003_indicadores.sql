-- migrate:up

-- Indicadores técnicos por sessão, calculados pelo motor de recolha sobre o fecho ajustado
-- (adj_close, ou close quando não existe). NULL enquanto não houver sessões suficientes.
-- A série completa do instrumento é recalculada em cada recolha, porque os ajustes do fornecedor
-- (dividendos, desdobramentos) alteram os fechos ajustados do passado.
ALTER TABLE daily_quotes
  ADD COLUMN ema9   DECIMAL(18,6) NULL AFTER volume,
  ADD COLUMN sma10  DECIMAL(18,6) NULL AFTER ema9,
  ADD COLUMN sma50  DECIMAL(18,6) NULL AFTER sma10,
  ADD COLUMN sma125 DECIMAL(18,6) NULL AFTER sma50,
  ADD COLUMN sma200 DECIMAL(18,6) NULL AFTER sma125;

-- migrate:down
ALTER TABLE daily_quotes DROP COLUMN ema9, DROP COLUMN sma10, DROP COLUMN sma50, DROP COLUMN sma125, DROP COLUMN sma200;
