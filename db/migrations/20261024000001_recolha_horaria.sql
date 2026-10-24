-- migrate:up
-- Recolha horária durante as sessões (dias úteis, 08:00–17:00 de Lisboa), registada à parte da diária.
ALTER TABLE job_runs MODIFY kind ENUM('fetch_update','fetch_intraday','alerts') NOT NULL;

-- migrate:down
DELETE FROM job_runs WHERE kind = 'fetch_intraday';
ALTER TABLE job_runs MODIFY kind ENUM('fetch_update','alerts') NOT NULL;
