-- migrate:up
-- Lista oficial de instrumentos da Euronext (ISIN.xlsx), carregada por scripts/isin-mic-from-xlsx.mjs.
-- Usada para preencher o ISIN-MIC dos instrumentos do catálogo: pelo script, e pelo motor de recolha
-- quando valida um instrumento novo. yahoo_symbol é o símbolo Euronext com o sufixo Yahoo do mercado.
CREATE TABLE euronext_isins (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  isin          CHAR(12)     NOT NULL,
  mic           CHAR(4)      NOT NULL,
  symbol        VARCHAR(32)  NOT NULL,              -- símbolo Euronext, ex.: GALP
  yahoo_symbol  VARCHAR(32)  NOT NULL,              -- ex.: GALP.LS
  name          VARCHAR(255) NULL,
  market        VARCHAR(64)  NOT NULL,              -- ex.: Euronext Lisbon
  imported_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_euronext_isins_yahoo (yahoo_symbol),
  UNIQUE KEY uq_euronext_isins_market (mic, symbol),
  KEY ix_euronext_isins_isin (isin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE euronext_isins;
