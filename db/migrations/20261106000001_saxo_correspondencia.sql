-- migrate:up
-- Correspondência do catálogo com a SAXO Bank: semelhança do nome (Yahoo vs SAXO) e data da última verificação.
ALTER TABLE saxo_instruments
  ADD COLUMN name_score DECIMAL(4,2) NULL AFTER source,
  ADD COLUMN checked_at TIMESTAMP(3) NULL AFTER name_score;
UPDATE saxo_instruments SET checked_at = resolved_at;

-- Instrumentos sem correspondência clara: ambíguo (vários candidatos na bolsa certa), só noutra bolsa, não encontrado,
-- deixou de ser negociável, ou erro na verificação. candidates: JSON com os candidatos da SAXO para escolha manual.
CREATE TABLE saxo_match_issues (
  instrument_id BIGINT UNSIGNED NOT NULL,
  environment   ENUM('sim','live') NOT NULL DEFAULT 'sim',
  status        ENUM('ambiguous','other_market','not_found','not_tradable','error') NOT NULL,
  message       VARCHAR(500) NULL,
  candidates    TEXT NULL,
  checked_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instrument_id, environment),
  CONSTRAINT fk_saxo_match_issues_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ligações do catálogo inteiro à SAXO (botão na página «Correspondência SAXO» ou revalidação semanal automática).
CREATE TABLE saxo_catalog_runs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  environment   ENUM('sim','live') NOT NULL DEFAULT 'sim',
  recheck       TINYINT(1) NOT NULL DEFAULT 0,
  trigger_kind  ENUM('manual','weekly') NOT NULL DEFAULT 'manual',
  status        ENUM('running','done','failed') NOT NULL DEFAULT 'running',
  total         INT UNSIGNED NOT NULL DEFAULT 0,
  processed     INT UNSIGNED NOT NULL DEFAULT 0,
  counts        TEXT NULL,
  detail        VARCHAR(500) NULL,
  started_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at   TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  KEY ix_saxo_catalog_runs_started (started_at),
  CONSTRAINT fk_saxo_catalog_runs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE saxo_catalog_runs;
DROP TABLE saxo_match_issues;
ALTER TABLE saxo_instruments DROP COLUMN checked_at, DROP COLUMN name_score;
