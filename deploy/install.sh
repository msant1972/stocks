#!/bin/bash
# Instala ou actualiza a aplicação Stocks neste servidor (Ubuntu). Idempotente: pode ser corrido em cada publicação.
#
#   sudo deploy/install.sh            instala/actualiza tudo, incluindo o proxy HTTPS (Caddy)
#   sudo deploy/install.sh --no-proxy sem Caddy (ex.: proxy já existente)
#
# Código em /opt/stocks, configuração em /etc/stocks/stocks.env, serviços systemd stocks-*.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/stocks
ENV_FILE=/etc/stocks/stocks.env
WITH_PROXY=1
[[ "${1:-}" == "--no-proxy" ]] && WITH_PROXY=0
[[ $EUID -eq 0 ]] || { echo "corra com sudo" >&2; exit 1; }

step() { echo; echo "==> $*"; }

step "Dependências do sistema"
PKGS=(nodejs npm mariadb-server mariadb-client python3-venv rsync)
(( WITH_PROXY )) && PKGS+=(caddy)
missing=()
for p in "${PKGS[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
if (( ${#missing[@]} )); then apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${missing[@]}"; fi
command -v dbmate >/dev/null || { echo "falta o dbmate em /usr/local/bin (ver deploy/README.md)" >&2; exit 1; }

step "Utilizador de sistema e pastas"
id stocks >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin stocks
install -d -m 755 "$APP"
install -d -m 750 -o root -g stocks /etc/stocks
install -d -m 750 -o stocks -g stocks /var/backups/stocks
install -d -m 755 -o stocks -g stocks /var/lib/stocks

if [[ ! -f "$ENV_FILE" ]]; then
  install -m 640 -o root -g stocks "$SRC/deploy/stocks.env.example" "$ENV_FILE"
  echo "Criado $ENV_FILE a partir do exemplo. Preencha STOCKS_DB_PASSWORD (e o SMTP) e volte a correr este script."
  exit 0
fi
set -a; . "$ENV_FILE"; set +a
[[ -n "${STOCKS_DB_PASSWORD:-}" ]] || { echo "STOCKS_DB_PASSWORD vazio em $ENV_FILE" >&2; exit 1; }

step "Código em $APP"
if [[ "$SRC" != "$APP" ]]; then
  rsync -a --delete --exclude .git --exclude node_modules --exclude .venv --exclude dist \
    --exclude .env --exclude '__pycache__' --exclude '*.egg-info' "$SRC/" "$APP/"
fi
chown -R root:root "$APP"
chmod +x "$APP"/deploy/bin/*.sh

step "Motores Python"
for e in fetcher alerts; do
  [[ -d "$APP/engines/$e/.venv" ]] || python3 -m venv "$APP/engines/$e/.venv"
  "$APP/engines/$e/.venv/bin/pip" install -q --upgrade pip
  "$APP/engines/$e/.venv/bin/pip" install -q -e "$APP/engines/$e"
done

step "API e frontend"
(cd "$APP/api" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
(cd "$APP/frontend" && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent && rm -rf node_modules)

step "Migrações da base de dados"
DATABASE_URL="mysql://${STOCKS_DB_USER}:${STOCKS_DB_PASSWORD}@${STOCKS_DB_HOST}:${STOCKS_DB_PORT}/${STOCKS_DB_NAME}" \
  dbmate --migrations-dir "$APP/db/migrations" --no-dump-schema --wait up

step "Serviços systemd"
install -m 644 "$APP"/deploy/systemd/*.service "$APP"/deploy/systemd/*.timer "$APP"/deploy/systemd/*.path /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now stocks-fetcher-run.timer stocks-fetcher-run.path stocks-daily.timer stocks-backup.timer
systemctl enable stocks-api.service
systemctl restart stocks-api.service

if (( WITH_PROXY )); then
  step "Proxy HTTPS (Caddy)"
  # Hash do script de tema embutido no index.html, para a Content-Security-Policy o permitir.
  HASH=$(python3 - "$APP/frontend/dist/index.html" <<'PY'
import base64, hashlib, re, sys
html = open(sys.argv[1], encoding="utf-8").read()
scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
print(" ".join("'sha256-%s'" % base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() for s in scripts))
PY
)
  sed "s|__THEME_SCRIPT_HASH__|$HASH|" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  systemctl enable caddy >/dev/null 2>&1
  systemctl reload caddy || systemctl restart caddy
fi

step "Verificação"
for i in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:${STOCKS_API_PORT:-3000}/health/ready" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:${STOCKS_API_PORT:-3000}/health/ready" && echo
systemctl --no-pager list-timers 'stocks-*'
echo
echo "Concluído. Criar contas: sudo -u stocks bash -c 'set -a; . $ENV_FILE; cd $APP/api && node src/cli.js create-user --email ... --name ...'"
