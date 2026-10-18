#!/bin/sh
# Recolha diária seguida da avaliação de alertas (stocks-daily.service).
set -u
cd /opt/stocks/engines/fetcher
# Uma falha na recolha não impede os alertas de avaliar os instrumentos que foram actualizados.
/opt/stocks/engines/fetcher/.venv/bin/python -m fetcher update || echo "recolha terminou com erros" >&2
cd /opt/stocks/engines/alerts
# O SMTP vem de Definições (BD) ou de STOCKS_SMTP_*; sem nenhum, os alertas correm em --dry-run.
exec /opt/stocks/engines/alerts/.venv/bin/python -m alerts run --dry-run-if-unconfigured
