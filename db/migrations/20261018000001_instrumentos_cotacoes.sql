-- migrate:up

-- Catálogo global de instrumentos, partilhado por todos os utilizadores.
-- O estado começa em 'pending' até o motor de recolha validar o ticker no fornecedor.
CREATE TABLE instruments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  symbol        VARCHAR(32)  NOT NULL,              -- símbolo Yahoo, ex.: GALP.LS
  exchange      VARCHAR(64)  NULL,                  -- preenchido pelo fornecedor
  currency      CHAR(3)      NULL,
  name          VARCHAR(255) NULL,
  status        ENUM('pending','active','invalid') NOT NULL DEFAULT 'pending',
  status_reason VARCHAR(255) NULL,
  first_session DATE         NULL,                  -- cobertura efectiva disponível
  last_session  DATE         NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_instruments_symbol (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uma linha por instrumento e sessão. close é o fecho não ajustado (usado nas operações simuladas);
-- adj_close é o fecho ajustado (usado nos gráficos).
CREATE TABLE daily_quotes (
  instrument_id BIGINT UNSIGNED NOT NULL,
  session_date  DATE           NOT NULL,
  open          DECIMAL(18,6)  NULL,
  high          DECIMAL(18,6)  NULL,
  low           DECIMAL(18,6)  NULL,
  close         DECIMAL(18,6)  NOT NULL,
  adj_close     DECIMAL(18,6)  NULL,
  volume        BIGINT UNSIGNED NULL,
  source        VARCHAR(32)    NOT NULL,
  fetched_at    TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instrument_id, session_date),
  CONSTRAINT fk_quotes_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fila de pedidos de recolha. A API insere 'initial' quando um instrumento é adicionado;
-- o motor reserva pedidos com SELECT ... FOR UPDATE SKIP LOCKED.
CREATE TABLE fetch_jobs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  instrument_id BIGINT UNSIGNED NOT NULL,
  kind          ENUM('initial','incremental') NOT NULL,
  status        ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
  attempts      INT UNSIGNED   NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_error    TEXT           NULL,
  rows_written  INT UNSIGNED   NULL,
  created_at    TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at    TIMESTAMP(3)   NULL,
  finished_at   TIMESTAMP(3)   NULL,
  PRIMARY KEY (id),
  KEY ix_fetch_jobs_pick (status, next_attempt_at),
  CONSTRAINT fk_jobs_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE fetch_jobs;
DROP TABLE daily_quotes;
DROP TABLE instruments;
