-- migrate:up

-- Contas criadas pelo comando de administração da API (não há registo público).
CREATE TABLE users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_admin      BOOLEAN      NOT NULL DEFAULT FALSE,
  disabled_at   TIMESTAMP(3) NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sessões de login. Guarda-se apenas o SHA-256 do token; o token em claro só existe no cookie.
CREATE TABLE sessions (
  token_hash    CHAR(64)        NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  created_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at    TIMESTAMP(3)    NOT NULL,
  PRIMARY KEY (token_hash),
  KEY ix_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uma lista de acompanhamento por utilizador sobre o catálogo global.
CREATE TABLE watchlist_items (
  user_id       BIGINT UNSIGNED NOT NULL,
  instrument_id BIGINT UNSIGNED NOT NULL,
  created_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, instrument_id),
  KEY ix_watchlist_instrument (instrument_id),
  CONSTRAINT fk_watchlist_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_watchlist_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uma carteira virtual por utilizador, em EUR. cash_balance só muda dentro das transacções das operações.
CREATE TABLE portfolios (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  currency        CHAR(3)         NOT NULL DEFAULT 'EUR',
  initial_capital DECIMAL(18,2)   NOT NULL,
  cash_balance    DECIMAL(18,2)   NOT NULL,
  created_at      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_portfolios_user (user_id),
  CONSTRAINT fk_portfolios_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_portfolios_cash CHECK (cash_balance >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Operações simuladas. Preço, moeda e data da cotação ficam registados na própria operação.
-- price é o fecho não ajustado; amount = ROUND(quantity * price, 2).
CREATE TABLE simulated_trades (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  portfolio_id    BIGINT UNSIGNED NOT NULL,
  instrument_id   BIGINT UNSIGNED NOT NULL,
  side            ENUM('buy','sell') NOT NULL,
  quantity        INT UNSIGNED    NOT NULL,
  price           DECIMAL(18,6)   NOT NULL,
  amount          DECIMAL(18,2)   NOT NULL,
  currency        CHAR(3)         NOT NULL,
  quote_date      DATE            NOT NULL,
  realized_pnl    DECIMAL(18,2)   NULL,              -- só nas vendas: valor da venda menos custo retirado
  idempotency_key VARCHAR(64)     NOT NULL,
  requested_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_trades_idempotency (portfolio_id, idempotency_key),
  KEY ix_trades_portfolio (portfolio_id, requested_at),
  CONSTRAINT fk_trades_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE,
  CONSTRAINT fk_trades_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id),
  CONSTRAINT ck_trades_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Movimentos de saldo: capital inicial e contrapartida de cada operação (amount com sinal).
CREATE TABLE cash_movements (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  portfolio_id  BIGINT UNSIGNED NOT NULL,
  kind          ENUM('initial','buy','sell') NOT NULL,
  amount        DECIMAL(18,2)   NOT NULL,
  trade_id      BIGINT UNSIGNED NULL,
  created_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_cash_portfolio (portfolio_id),
  CONSTRAINT fk_cash_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE,
  CONSTRAINT fk_cash_trade FOREIGN KEY (trade_id) REFERENCES simulated_trades (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Posição actual por instrumento. Guarda-se o custo total das unidades detidas (custo médio ponderado);
-- o custo médio é cost_basis / quantity, calculado na leitura, para não acumular arredondamentos.
CREATE TABLE positions (
  portfolio_id  BIGINT UNSIGNED NOT NULL,
  instrument_id BIGINT UNSIGNED NOT NULL,
  quantity      INT UNSIGNED    NOT NULL,
  cost_basis    DECIMAL(18,2)   NOT NULL,
  realized_pnl  DECIMAL(18,2)   NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (portfolio_id, instrument_id),
  CONSTRAINT fk_positions_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE,
  CONSTRAINT fk_positions_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Regras de alerta sobre o fecho diário.
--   close_above / close_below: threshold em EUR; disparam quando a condição passa a verificar-se
--     (last_state guarda o resultado da última sessão avaliada; NULL após criação ou reactivação).
--   change_up / change_down: threshold em % (positivo); avaliadas em cada sessão face à anterior.
CREATE TABLE alert_rules (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id                BIGINT UNSIGNED NOT NULL,
  instrument_id          BIGINT UNSIGNED NOT NULL,
  kind                   ENUM('close_above','close_below','change_up','change_down') NOT NULL,
  threshold              DECIMAL(18,6)   NOT NULL,
  active                 BOOLEAN         NOT NULL DEFAULT TRUE,
  last_state             BOOLEAN         NULL,
  last_evaluated_session DATE            NULL,
  created_at             TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_alert_rules_user (user_id),
  KEY ix_alert_rules_instrument (instrument_id, active),
  CONSTRAINT fk_alert_rules_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_alert_rules_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id),
  CONSTRAINT ck_alert_rules_threshold CHECK (threshold > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Resumos enviados por email: um por utilizador e por execução do motor de alertas.
-- 'uncertain' = o servidor SMTP pode ter aceite a mensagem sem confirmação local; não é reenviado.
CREATE TABLE email_deliveries (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  recipient     VARCHAR(255)    NOT NULL,
  subject       VARCHAR(255)    NOT NULL,
  status        ENUM('sending','sent','failed','uncertain') NOT NULL DEFAULT 'sending',
  event_count   INT UNSIGNED    NOT NULL,
  error         TEXT            NULL,
  created_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at   TIMESTAMP(3)    NULL,
  PRIMARY KEY (id),
  KEY ix_deliveries_user (user_id, created_at),
  CONSTRAINT fk_deliveries_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Eventos detectados. A chave única (regra, sessão) impede notificar duas vezes o mesmo evento.
-- delivery_id fica NULL até o evento entrar num resumo; volta a NULL se esse envio falhar.
CREATE TABLE alert_events (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rule_id       BIGINT UNSIGNED NOT NULL,
  session_date  DATE            NOT NULL,
  close         DECIMAL(18,6)   NOT NULL,
  previous_close DECIMAL(18,6)  NULL,
  change_pct    DECIMAL(10,4)   NULL,
  delivery_id   BIGINT UNSIGNED NULL,
  created_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_alert_events (rule_id, session_date),
  KEY ix_alert_events_delivery (delivery_id),
  CONSTRAINT fk_alert_events_rule FOREIGN KEY (rule_id) REFERENCES alert_rules (id) ON DELETE CASCADE,
  CONSTRAINT fk_alert_events_delivery FOREIGN KEY (delivery_id) REFERENCES email_deliveries (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Execuções dos processos agendados (recolha diária e alertas), para diagnóstico e encadeamento.
CREATE TABLE job_runs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind          ENUM('fetch_update','alerts') NOT NULL,
  status        ENUM('running','done','failed') NOT NULL DEFAULT 'running',
  detail        TEXT            NULL,
  started_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at   TIMESTAMP(3)    NULL,
  PRIMARY KEY (id),
  KEY ix_job_runs_kind (kind, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Acções relevantes. Nunca contém palavras-passe, tokens ou credenciais.
CREATE TABLE audit_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NULL,
  action        VARCHAR(64)     NOT NULL,
  entity        VARCHAR(64)     NULL,
  entity_id     BIGINT UNSIGNED NULL,
  detail        TEXT            NULL,
  created_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_audit_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE audit_log;
DROP TABLE job_runs;
DROP TABLE alert_events;
DROP TABLE email_deliveries;
DROP TABLE alert_rules;
DROP TABLE positions;
DROP TABLE cash_movements;
DROP TABLE simulated_trades;
DROP TABLE portfolios;
DROP TABLE watchlist_items;
DROP TABLE sessions;
DROP TABLE users;
