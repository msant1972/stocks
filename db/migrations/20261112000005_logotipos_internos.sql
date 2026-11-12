-- migrate:up
-- Logotipos dos instrumentos guardados na aplicação (módulo Administração → Logotipos): o browser do administrador
-- descarrega da Brandfetch os que faltam, 10 de cada vez, e envia-os para aqui. As páginas mostram só estes.
-- status 'ok': há imagem; 'missing': a Brandfetch não tinha logotipo (não se volta a pedir, salvo «Tentar de novo»).
CREATE TABLE instrument_logos (
  instrument_id BIGINT UNSIGNED NOT NULL,
  status        ENUM('ok','missing') NOT NULL,
  image         MEDIUMBLOB       NULL,
  mime          VARCHAR(20)      NULL,
  domain        VARCHAR(255)     NULL,
  source        VARCHAR(20)      NOT NULL DEFAULT 'brandfetch',
  updated_by    BIGINT UNSIGNED  NULL,
  updated_at    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instrument_id),
  KEY ix_instrument_logos_status (status),
  CONSTRAINT fk_instrument_logos_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (id) ON DELETE CASCADE,
  CONSTRAINT fk_instrument_logos_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE instrument_logos;
