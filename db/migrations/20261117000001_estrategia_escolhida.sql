-- migrate:up
-- Estratégia escolhida por cada utilizador para cada instrumento (no Charts). É a que a Automação usa para comprar nesse
-- instrumento e a que filtra os Sinais e os sinais da Visão geral. strategy_id NULL = «Nenhuma» (escolha explícita de não
-- negociar o instrumento). Sem linha, vale a melhor estratégia ligada do instrumento (o comportamento anterior).
CREATE TABLE instrument_strategy_choices (
  user_id       BIGINT UNSIGNED NOT NULL,
  instrument_id BIGINT UNSIGNED NOT NULL,
  strategy_id   VARCHAR(32)     NULL,
  updated_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, instrument_id),
  KEY ix_strategy_choice_instrument (instrument_id),
  CONSTRAINT fk_strategy_choice_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_strategy_choice_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE instrument_strategy_choices;
