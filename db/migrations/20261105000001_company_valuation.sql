-- migrate:up
-- Campos do Yahoo para a secção «Valorização» do painel Empresa (Charts): preço de referência no momento da recolha
-- (os rácios são reescalados ao fecho do dia), valor da empresa, dívida, caixa, fluxo de caixa livre e consenso dos
-- analistas. As contas anuais (financials, JSON) passam também a trazer dilutedEps, freeCashFlow, equity e shares.
ALTER TABLE company_profiles
  ADD COLUMN ref_price            DECIMAL(18,6) NULL AFTER low_52w,       -- preço do Yahoo quando o perfil foi recolhido
  ADD COLUMN enterprise_value     DECIMAL(24,2) NULL AFTER ref_price,
  ADD COLUMN enterprise_to_ebitda DECIMAL(18,4) NULL AFTER enterprise_value,
  ADD COLUMN ebitda               DECIMAL(24,2) NULL AFTER enterprise_to_ebitda,
  ADD COLUMN total_debt           DECIMAL(24,2) NULL AFTER ebitda,
  ADD COLUMN total_cash           DECIMAL(24,2) NULL AFTER total_debt,
  ADD COLUMN shares_outstanding   BIGINT UNSIGNED NULL AFTER total_cash,
  ADD COLUMN free_cashflow        DECIMAL(24,2) NULL AFTER shares_outstanding, -- últimos 12 meses, na moeda das contas
  ADD COLUMN book_value           DECIMAL(18,4) NULL AFTER free_cashflow,      -- por acção, na moeda das contas
  ADD COLUMN forward_eps          DECIMAL(18,4) NULL AFTER book_value,
  ADD COLUMN earnings_growth      DECIMAL(12,6) NULL AFTER forward_eps,        -- fracção
  ADD COLUMN revenue_growth       DECIMAL(12,6) NULL AFTER earnings_growth,    -- fracção
  ADD COLUMN payout_ratio         DECIMAL(12,6) NULL AFTER revenue_growth,     -- fracção
  ADD COLUMN target_mean          DECIMAL(18,6) NULL AFTER payout_ratio,       -- preços-alvo na moeda de cotação
  ADD COLUMN target_median        DECIMAL(18,6) NULL AFTER target_mean,
  ADD COLUMN target_low           DECIMAL(18,6) NULL AFTER target_median,
  ADD COLUMN target_high          DECIMAL(18,6) NULL AFTER target_low,
  ADD COLUMN analyst_count        SMALLINT UNSIGNED NULL AFTER target_high,
  ADD COLUMN recommendation_key   VARCHAR(16)   NULL AFTER analyst_count,      -- strong_buy, buy, hold, underperform, sell
  ADD COLUMN recommendation_mean  DECIMAL(6,3)  NULL AFTER recommendation_key; -- 1 = compra forte … 5 = venda

-- Os perfis existentes ficam sem estes campos até à próxima recolha (python -m fetcher profiles --all para os ter já).

-- migrate:down
ALTER TABLE company_profiles
  DROP COLUMN ref_price, DROP COLUMN enterprise_value, DROP COLUMN enterprise_to_ebitda, DROP COLUMN ebitda,
  DROP COLUMN total_debt, DROP COLUMN total_cash, DROP COLUMN shares_outstanding, DROP COLUMN free_cashflow,
  DROP COLUMN book_value, DROP COLUMN forward_eps, DROP COLUMN earnings_growth, DROP COLUMN revenue_growth,
  DROP COLUMN payout_ratio, DROP COLUMN target_mean, DROP COLUMN target_median, DROP COLUMN target_low,
  DROP COLUMN target_high, DROP COLUMN analyst_count, DROP COLUMN recommendation_key, DROP COLUMN recommendation_mean;
