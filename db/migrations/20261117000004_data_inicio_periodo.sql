-- migrate:up
-- start_date NULL = o utilizador escolheu o período do módulo (últimos 24 meses no Portfolio Recomendado, o período na Rotação).
-- Sem linha vale a data por omissão da interface (1 jan. 2026).
ALTER TABLE portfolio_start_dates MODIFY start_date DATE NULL;

-- migrate:down
DELETE FROM portfolio_start_dates WHERE start_date IS NULL;
ALTER TABLE portfolio_start_dates MODIFY start_date DATE NOT NULL;
