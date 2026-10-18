#!/bin/sh
# Cópia diária da base de dados (stocks-backup.service). Guarda os últimos 14 dias.
# Os dados que importam são utilizadores, carteiras, operações e regras; as cotações são reconstruíveis.
set -eu
umask 077  # a cópia contém hashes de palavras-passe e dados dos utilizadores
DIR=/var/backups/stocks
FILE="$DIR/stocks-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
MYSQL_PWD="$STOCKS_DB_PASSWORD" mariadb-dump --single-transaction --quick --routines \
  -h "$STOCKS_DB_HOST" -P "$STOCKS_DB_PORT" -u "$STOCKS_DB_USER" "$STOCKS_DB_NAME" | gzip > "$FILE.part"
mv "$FILE.part" "$FILE"
find "$DIR" -name 'stocks-*.sql.gz' -mtime +14 -delete
echo "cópia criada: $FILE ($(du -h "$FILE" | cut -f1))"
