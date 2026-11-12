-- migrate:up
-- Fotografia do utilizador (JPEG/PNG/WebP, reduzida no browser): mostrada na barra lateral e em Utilizadores.
ALTER TABLE users
  ADD COLUMN photo            MEDIUMBLOB   NULL AFTER name,
  ADD COLUMN photo_type       VARCHAR(20)  NULL AFTER photo,
  ADD COLUMN photo_updated_at TIMESTAMP(3) NULL AFTER photo_type;

-- migrate:down
ALTER TABLE users DROP COLUMN photo_updated_at, DROP COLUMN photo_type, DROP COLUMN photo;
