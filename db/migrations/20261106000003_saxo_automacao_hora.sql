-- migrate:up
-- A automação passa a correr de hora a hora: uma execução por utilizador, dia e hora.
ALTER TABLE saxo_automation_runs
  ADD COLUMN run_hour TINYINT UNSIGNED NOT NULL DEFAULT 8 AFTER run_date,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (user_id, run_date, run_hour);

-- migrate:down
DELETE r FROM saxo_automation_runs r
  JOIN saxo_automation_runs k ON k.user_id = r.user_id AND k.run_date = r.run_date AND k.run_hour < r.run_hour;
ALTER TABLE saxo_automation_runs
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (user_id, run_date),
  DROP COLUMN run_hour;
