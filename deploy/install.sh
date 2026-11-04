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
PKGS=(nodejs npm mariadb-server mariadb-client python3-venv rsync fail2ban)
(( WITH_PROXY )) && PKGS+=(caddy)
missing=()
for p in "${PKGS[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
if (( ${#missing[@]} )); then apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${missing[@]}"; fi
command -v dbmate >/dev/null || { echo "falta o dbmate em /usr/local/bin (ver deploy/README.md)" >&2; exit 1; }

step "Afinação do servidor (MariaDB, SSH e swap)"
# MariaDB afinado para o servidor (deploy/mariadb/60-stocks.cnf); reinicia só quando o ficheiro muda.
if ! cmp -s "$SRC/deploy/mariadb/60-stocks.cnf" /etc/mysql/mariadb.conf.d/60-stocks.cnf; then
  install -m 644 "$SRC/deploy/mariadb/60-stocks.cnf" /etc/mysql/mariadb.conf.d/60-stocks.cnf
  systemctl restart mariadb
fi
# SSH (deploy/ssh/10-stocks.conf): sem login directo do root, menos tentativas e tempo para autenticar. Valida a
# configuração antes de recarregar; com erro repõe a anterior. As sessões abertas não são afectadas.
if ! cmp -s "$SRC/deploy/ssh/10-stocks.conf" /etc/ssh/sshd_config.d/10-stocks.conf; then
  cp -p /etc/ssh/sshd_config.d/10-stocks.conf /tmp/10-stocks.conf.prev 2>/dev/null || rm -f /tmp/10-stocks.conf.prev
  install -m 644 "$SRC/deploy/ssh/10-stocks.conf" /etc/ssh/sshd_config.d/10-stocks.conf
  if sshd -t; then
    systemctl reload ssh
  else
    echo "configuração SSH inválida: reposta a anterior" >&2
    if [ -f /tmp/10-stocks.conf.prev ]; then mv /tmp/10-stocks.conf.prev /etc/ssh/sshd_config.d/10-stocks.conf; else rm -f /etc/ssh/sshd_config.d/10-stocks.conf; fi
  fi
fi
# fail2ban: bloqueia temporariamente os IPs que falham o login SSH (deploy/fail2ban/stocks.local); o IP do
# administrador deve ficar num ficheiro à parte, /etc/fail2ban/jail.d/stocks-ignoreip.local (ver deploy/README.md).
install -d /etc/fail2ban/jail.d
if ! cmp -s "$SRC/deploy/fail2ban/stocks.local" /etc/fail2ban/jail.d/stocks.local; then
  install -m 644 "$SRC/deploy/fail2ban/stocks.local" /etc/fail2ban/jail.d/stocks.local
  systemctl enable --now fail2ban >/dev/null 2>&1
  systemctl restart fail2ban
fi
# Swap de 2 GB como margem contra falta de memória (só se o sistema não tiver nenhuma).
if [[ -z "$(swapon --show --noheadings)" ]]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -q -w vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/60-stocks.conf

step "Utilizador de sistema e pastas"
id stocks-svc >/dev/null 2>&1 || useradd --system --user-group --home-dir "$APP" --shell /usr/sbin/nologin stocks-svc
install -d -m 755 "$APP"
install -d -m 750 -o root -g stocks-svc /etc/stocks
install -d -m 750 -o stocks-svc -g stocks-svc /var/backups/stocks
install -d -m 755 -o stocks-svc -g stocks-svc /var/lib/stocks

if [[ ! -f "$ENV_FILE" ]]; then
  install -m 640 -o root -g stocks-svc "$SRC/deploy/stocks.env.example" "$ENV_FILE"
  echo "Criado $ENV_FILE a partir do exemplo. Preencha STOCKS_DB_PASSWORD (e o SMTP) e volte a correr este script."
  exit 0
fi
# Chave para cifrar segredos guardados na BD (palavra-passe SMTP). Criada uma vez; nunca é substituída,
# porque isso tornaria ilegíveis os segredos já guardados.
if [[ ! -f /etc/stocks/secret.key ]]; then
  (umask 027; head -c 32 /dev/urandom | base64 > /etc/stocks/secret.key)
  echo "Criada a chave de cifra /etc/stocks/secret.key"
fi
chown root:stocks-svc /etc/stocks/secret.key
chmod 640 /etc/stocks/secret.key

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
systemctl enable --now stocks-fetcher-run.timer stocks-fetcher-run.path stocks-daily.timer stocks-intraday.timer stocks-backup.timer stocks-ops.timer stocks-analysis.timer stocks-profiles.timer
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
echo "Concluído. Criar contas: sudo -u stocks-svc bash -c 'set -a; . $ENV_FILE; cd $APP/api && node src/cli.js create-user --email ... --name ...'"
