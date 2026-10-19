-- migrate:up

-- Identificação Euronext do instrumento (ISIN + MIC), usada pelo módulo de livro de ofertas
-- (docs/arquitectura/orderbook-spec.md). Opcional: só os mercados Euronext têm livro de ofertas.
ALTER TABLE instruments
  ADD COLUMN isin CHAR(12) NULL AFTER name,
  ADD COLUMN mic  CHAR(4)  NULL AFTER isin;

-- migrate:down
ALTER TABLE instruments DROP COLUMN isin, DROP COLUMN mic;
