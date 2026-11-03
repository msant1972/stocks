-- migrate:up
-- Resultados das análises recalculadas periodicamente (scripts/analysis-revalidation.mjs, stocks-analysis.timer):
-- validação das Promessas e persistência dos ganhadores e perdedores. Uma linha por análise, substituída a cada cálculo.
CREATE TABLE analysis_results (
  name         VARCHAR(64)  NOT NULL,
  data         MEDIUMTEXT   NOT NULL,             -- JSON
  computed_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE analysis_results;
