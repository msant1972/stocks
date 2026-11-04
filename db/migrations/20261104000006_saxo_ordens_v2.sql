-- migrate:up
-- Ordens SAXO: estado final real (executada, expirada, cancelada) a partir do histórico da SAXO, quantidade e preço
-- executados, ordens de stop associadas a uma compra (fixo ou móvel) e alterações de ordens abertas.
ALTER TABLE saxo_orders
  MODIFY status ENUM('sending','working','filled','expired','cancelled','rejected','ended','unknown') NOT NULL DEFAULT 'sending',
  MODIFY order_type ENUM('market','limit','stop','trailing_stop') NOT NULL,
  ADD COLUMN parent_id       BIGINT UNSIGNED NULL AFTER user_id,
  ADD COLUMN stop_price      DECIMAL(18,6) NULL AFTER limit_price,
  ADD COLUMN trail_distance  DECIMAL(18,6) NULL AFTER stop_price,
  ADD COLUMN filled_quantity BIGINT UNSIGNED NULL AFTER app_price,
  ADD COLUMN fill_price      DECIMAL(18,6) NULL AFTER filled_quantity,
  ADD COLUMN finished_at     TIMESTAMP(3) NULL AFTER fill_price,
  ADD CONSTRAINT fk_saxo_orders_parent FOREIGN KEY (parent_id) REFERENCES saxo_orders (id) ON DELETE CASCADE;

ALTER TABLE saxo_notifications MODIFY kind ENUM('ended','filled','expired','cancelled') NOT NULL DEFAULT 'ended';

-- migrate:down
DELETE FROM saxo_notifications WHERE kind <> 'ended';
ALTER TABLE saxo_notifications MODIFY kind ENUM('ended') NOT NULL DEFAULT 'ended';
DELETE FROM saxo_orders WHERE parent_id IS NOT NULL OR order_type IN ('stop','trailing_stop');
UPDATE saxo_orders SET status = 'ended' WHERE status IN ('filled','expired');
ALTER TABLE saxo_orders
  DROP FOREIGN KEY fk_saxo_orders_parent,
  DROP COLUMN finished_at, DROP COLUMN fill_price, DROP COLUMN filled_quantity,
  DROP COLUMN trail_distance, DROP COLUMN stop_price, DROP COLUMN parent_id,
  MODIFY order_type ENUM('market','limit') NOT NULL,
  MODIFY status ENUM('sending','working','ended','cancelled','rejected','unknown') NOT NULL DEFAULT 'sending';
