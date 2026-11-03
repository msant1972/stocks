-- migrate:up
-- Esquema de passos de preço do instrumento na SAXO (JSON dos detalhes); as ordens limitadas têm de o respeitar.
ALTER TABLE saxo_instruments ADD COLUMN tick_scheme TEXT NULL AFTER min_size;

-- migrate:down
ALTER TABLE saxo_instruments DROP COLUMN tick_scheme;
