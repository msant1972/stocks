#!/bin/sh
# Recolha diária seguida da avaliação de alertas (stocks-daily.service).
set -u
cd /opt/stocks/engines/fetcher
# Uma falha na recolha não impede os alertas de avaliar os instrumentos que foram actualizados.
/opt/stocks/engines/fetcher/.venv/bin/python -m fetcher update || echo "recolha terminou com erros" >&2
cd /opt/stocks/engines/alerts
if [ -n "${STOCKS_SMTP_HOST:-}" ]; then
  exec /opt/stocks/engines/alerts/.venv/bin/python -m alerts run
else
  echo "SMTP não configurado: alertas em --dry-run, nenhum email enviado" >&2
  exec /opt/stocks/engines/alerts/.venv/bin/python -m alerts run --dry-run
fi
