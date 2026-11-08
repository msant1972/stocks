# Implantação

Toda a aplicação corre num único servidor Ubuntu, `stocks.graus.pt`. Desde 2 nov. 2026 é um VPS com Ubuntu (26.04), **4 vCPU, 8 GB de RAM e 100 GB de disco SSD**, instalado de raiz com este procedimento (afinação na secção «Recursos do servidor»).

```text
Internet ──HTTPS──▶ Caddy (:443, certificado automático)
                      └─▶ API Node (127.0.0.1:3000) ── serve também o frontend compilado
                             └─▶ MariaDB (127.0.0.1:3306)
systemd timers ─▶ motor de recolha (cargas iniciais a cada 5 min; actualização diária)
               └▶ motor de alertas (a seguir à actualização diária)
               └▶ cópia de segurança (diária)
```

| Unit | Quando | O que faz |
|---|---|---|
| `stocks-api.service` | sempre | API e frontend |
| `stocks-fetcher-run.path` | quando a aplicação pede | Arranca o motor de imediato ao adicionar símbolos ou em «Validar agora» (a API escreve em `/var/lib/stocks/fetch-request`) |
| `stocks-fetcher-run.timer` | a cada 5 min | Rede de segurança: processa os pedidos que ficarem na fila |
| `stocks-intraday.timer` | dias úteis, de hora a hora das 08:23 às 17:23 de Lisboa | Actualização das cotações durante a sessão, sem alertas (`fetcher update --intraday`) |
| `stocks-daily.timer` | dias úteis, 19:01 de Lisboa | Actualização com os fechos definitivos e, a seguir, alertas ([bin/daily.sh](bin/daily.sh)) |
| `stocks-backup.timer` | diariamente, 03:30 UTC | `mariadb-dump` para `/var/backups/stocks`, guardado durante 30 dias |
| `stocks-ops.timer` | dias úteis, 21:00 de Lisboa | Aviso operacional por email aos administradores (`alerts ops`): execuções falhadas ou presas, recolha diária em falta, instrumentos com recolha falhada, dados parados; no máximo um email por dia |
| `stocks-analysis.timer` | sábado, 09:00 de Lisboa | Recalcula a validação das Promessas e a persistência dos ganhadores (`scripts/analysis-revalidation.mjs`, tabela `analysis_results`) |
| `stocks-profiles.timer` | domingo, 08:00 de Lisboa | Perfis das empresas para o painel «Empresa» do Charts (`fetcher profiles`: actividade, indicadores e contas anuais, fonte Yahoo); só os que não têm perfil ou o têm há mais de 7 dias. Forçar agora: `sudo systemctl start --no-block stocks-profiles` |

Os serviços correm com o utilizador de sistema `stocks-svc` (sem login nem sudo), com o sistema de ficheiros só de leitura (`ProtectSystem=strict`). A configuração e os segredos ficam em `/etc/stocks/stocks.env` (`root:stocks-svc`, modo 640). A chave que cifra os segredos guardados na BD (palavra-passe SMTP) fica em `/etc/stocks/secret.key`, criada pelo `install.sh` e nunca substituída: perdê-la obriga a voltar a introduzir a palavra-passe SMTP.

## Pré-requisitos

- Ubuntu com acesso `sudo`.
- A timezone do sistema em Lisboa, para que os registos (`journalctl`), as listas de timers e as horas da base de dados mostrem a hora de Lisboa. Os horários dos timers já indicam `Europe/Lisbon` (e o backup UTC), e a API e os alertas trabalham em UTC, por isso o funcionamento não depende disto. Se o MariaDB já estiver instalado, reinicie-o (e a API) para assumir a nova timezone:
  ```bash
  sudo timedatectl set-timezone Europe/Lisbon
  sudo systemctl restart mariadb stocks-api   # só se já estiverem instalados
  ```
- O DNS de `stocks.graus.pt` a apontar para o IP público do servidor.
- As portas **80 e 443** abertas na firewall: o Caddy precisa delas para obter o certificado. A 3000 e a 3306 não devem ser abertas (a API e o MariaDB só escutam em `127.0.0.1`). No servidor actual, a firewall `ufw` está **desligada** por decisão do administrador (não se liga sem lhe perguntar); só o SSH (22), o Caddy (80 e 443) escutam fora de `127.0.0.1`. Desde 8 nov. 2026 há uma **firewall externa** (do fornecedor, fora do servidor) que só deixa chegar ao SSH os IPs de casa e do escritório do administrador; o `fail2ban` fica como segunda camada. Os IPs autorizados gerem-se no painel dessa firewall, não neste repositório. Para a ligar, só com entrada nas portas 22/tcp (SSH), 80/tcp, 443/tcp e 443/udp (HTTP/3) e saída livre (Yahoo, Euronext, SAXO, SMTP, GitHub):
  ```bash
  sudo ufw default deny incoming && sudo ufw default allow outgoing
  sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
  sudo ufw enable
  ```
- O dbmate em `/usr/local/bin`:
  ```bash
  sudo curl -fsSL -o /usr/local/bin/dbmate https://github.com/amacneil/dbmate/releases/download/v2.37.0/dbmate-linux-amd64
  sudo chmod +x /usr/local/bin/dbmate
  ```
- A base de dados e o utilizador MariaDB criados:
  ```sql
  CREATE DATABASE stocks CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'stocks'@'localhost' IDENTIFIED BY '<palavra-passe>';
  GRANT ALL ON stocks.* TO 'stocks'@'localhost';
  ```

## Instalar ou actualizar

```bash
git clone git@github.com:msant1972/stocks.git && cd stocks   # ou git pull numa cópia existente
sudo deploy/install.sh
```

Na primeira execução, o script cria `/etc/stocks/stocks.env` a partir de [stocks.env.example](stocks.env.example) e termina. Preencha `STOCKS_DB_PASSWORD` e o SMTP, e volte a correr o script.

O script faz o seguinte, e pode ser repetido em cada publicação:
1. instala as dependências em falta;
2. copia o código para `/opt/stocks`;
3. cria os ambientes Python;
4. instala a API e compila o frontend;
5. aplica as migrações;
6. instala e reinicia os serviços;
7. configura o Caddy, com a CSP a permitir só o script de tema do `index.html`;
8. verifica `/health/ready`.

Criar a primeira conta:

```bash
sudo -u stocks-svc bash -c 'set -a; . /etc/stocks/stocks.env; cd /opt/stocks/api && node src/cli.js create-user --email miguel@graus.pt --name "Miguel" --admin'
```

No primeiro login é pedido que configure a autenticação em dois passos (obrigatória). Se um administrador perder o telemóvel e os códigos de recuperação, e não houver outro administrador para a repor na página Utilizadores:

```bash
sudo -u stocks-svc bash -c 'set -a; . /etc/stocks/stocks.env; cd /opt/stocks/api && node src/cli.js reset-mfa --email miguel@graus.pt'
```

Os segredos TOTP são cifrados com `/etc/stocks/secret.key`: perder ou substituir esta chave invalida o 2.º factor de todos (repor com `reset-mfa`). A cópia fora do servidor (autobackup do VPS) inclui-a.

Carregar a lista inicial de instrumentos:

```bash
sudo -u stocks-svc bash -c 'set -a; . /etc/stocks/stocks.env; cd /opt/stocks/engines/fetcher && .venv/bin/python -m fetcher add --file seeds/instrumentos_iniciais.txt && .venv/bin/python -m fetcher run'
```

Carregar a lista oficial da Euronext (`ISIN.xlsx`) para a tabela `euronext_isins` e preencher o ISIN-MIC (livro de ofertas) dos instrumentos que ainda não o têm; sem `--apply` só mostra o que faria. Daí em diante, o motor de recolha preenche o ISIN-MIC de cada instrumento novo ao validá-lo. Volte a correr o script quando actualizar o ficheiro:

```bash
sudo -u stocks-svc bash -c 'set -a; . /etc/stocks/stocks.env; cd /opt/stocks/api && node ../scripts/isin-mic-from-xlsx.mjs --apply'
```

Ver o aviso operacional sem o enviar, ou forçar o recálculo das análises:

```bash
sudo -u stocks-svc bash -c 'set -a; . /etc/stocks/stocks.env; cd /opt/stocks/engines/alerts && .venv/bin/python -m alerts ops --dry-run'
sudo systemctl start stocks-analysis
```

## Operação

```bash
systemctl status stocks-api                        # estado da API
journalctl -u stocks-api -f                        # registos da API
journalctl -u stocks-daily --since today           # recolha diária e alertas
systemctl list-timers 'stocks-*'                   # próximas execuções
sudo systemctl start stocks-daily                  # forçar recolha e alertas agora
sudo systemctl start stocks-backup                 # forçar uma cópia de segurança
```

Depois de aumentar `STOCKS_HISTORY_YEARS` (5 por omissão desde 8 nov. 2026; era 3), completar o histórico dos instrumentos já existentes (feito em produção a 8 nov. 2026, ao passar para 5):

```bash
sudo -u stocks-svc bash -c 'set -a; . /etc/stocks/stocks.env; cd /opt/stocks/engines/fetcher && .venv/bin/python -m fetcher backfill'
```

Faz um pedido ao Yahoo por instrumento (alguns minutos para cerca de 300); os pedidos que falharem são repetidos pelo timer de 5 minutos. As sessões existentes são actualizadas, sem duplicados.

**SAXO Bank.** Cada utilizador cria uma aplicação no portal de programadores da SAXO (ambiente de simulação, grant type «Code», URL de retorno `https://stocks.graus.pt/api/v1/integrations/saxo/callback`, que depende de `STOCKS_PUBLIC_ORIGIN`) e guarda a chave e o segredo em Definições → SAXO Bank (o segredo é cifrado com `/etc/stocks/secret.key`); «Ligar à SAXO» faz o login na SAXO e os tokens renovam-se sozinhos (a vigia renova-os antes de expirarem; se o servidor ficar parado mais do que a validade do refresh token, é preciso voltar a ligar). Só serve para a conta de simulação: `STOCKS_SAXO_ALLOW_LIVE=false` (por omissão) recusa a conta real. A API acompanha as ordens SAXO abertas por streaming (WebSocket para `sim-streaming.saxobank.com`; `STOCKS_SAXO_STREAMING=false` desliga) e confirma-as a cada `STOCKS_SAXO_WATCH_SECONDS` (60; 0 desliga tudo) e, quando uma deixa de estar aberta, corre `python -m alerts saxo` (usa o SMTP abaixo). Para ver os avisos pendentes sem enviar: `sudo -u stocks-svc bash -c 'set -a; . /etc/stocks/stocks.env; cd /opt/stocks/engines/alerts && .venv/bin/python -m alerts saxo --dry-run'`.

O SMTP configura-se em **Definições → Envio de email (SMTP)** (administradores), com botão para enviar um email de teste. As variáveis `STOCKS_SMTP_*` só são usadas se não houver configuração em Definições. Sem nenhuma das duas, os alertas correm em `--dry-run`: os emails aparecem só no `journalctl -u stocks-daily` e não são enviados.

## Cópias de segurança e recuperação

Cópias:

1. **Dumps diários** (`stocks-backup.timer`, 03:30 UTC) em `/var/backups/stocks`, guardados 30 dias (cerca de 10 MB cada). São consistentes, porque são feitos com `mariadb-dump --single-transaction`.
2. **Cópia fora do servidor:** autobackup do VPS, feito pelo fornecedor (frequência e retenção definidas no painel do fornecedor). Protege contra a perda do servidor e inclui os dumps do ponto 1, a configuração e a chave `/etc/stocks/secret.key`. Numa recuperação a partir do autobackup, restaure o dump mais recente (procedimento abaixo) em vez de confiar nos ficheiros do MariaDB copiados com o servidor ligado.

O restauro do dump foi testado a 3 nov. 2026 no servidor actual: dump novo restaurado em `stocks_restore` em 7 s, com as mesmas contagens em todas as tabelas e os mesmos saldos. Falta experimentar a recuperação de um ficheiro a partir do autobackup, no painel do fornecedor. Repita o teste periodicamente, por exemplo uma vez por trimestre.

Restaurar, depois de parar a API e os timers:

```bash
sudo systemctl stop stocks-api stocks-fetcher-run.timer stocks-intraday.timer stocks-daily.timer
gunzip -c /var/backups/stocks/stocks-<data>.sql.gz | sudo mariadb stocks
sudo systemctl start stocks-api stocks-fetcher-run.timer stocks-intraday.timer stocks-daily.timer
```

Teste o restauro periodicamente numa base separada, por exemplo `stocks_restore`.

## Reverter uma publicação

1. `git checkout <versão anterior>` e `sudo deploy/install.sh`.
2. As migrações não são revertidas automaticamente. Se a versão anterior não for compatível com o esquema actual, avalie `dbmate rollback`; se for preciso restaurar uma cópia, aceite e reconcilie as escritas posteriores.
3. Valide saldos, posições, recolhas e alertas antes de retomar os timers.

## Dependências e CI

O CI corre, em cada componente, a análise estática (ESLint na API e no frontend, Ruff nos motores), a auditoria de dependências (`npm audit --audit-level=high`, `pip-audit`) e os testes, com as versões da produção (MariaDB 11.8, Python 3.14, Node 22). Na API, `overrides` no `package.json` forçam versões corrigidas do `glob` (via `@fastify/static`) e do `uuid` (via ExcelJS). Ficam alertas moderados no `minimatch` antigo usado pelo `archiver` do ExcelJS (só ao gerar o modelo Excel, com padrões fixos do código): a correcção exigiria descer o ExcelJS para a versão 3.

## Recursos do servidor

VPS com 4 vCPU, 8 GB de RAM e 100 GB de disco SSD. O `install.sh` aplica a afinação (idempotente):

| Componente | Configuração | Porquê |
|---|---|---|
| MariaDB | `deploy/mariadb/60-stocks.cnf` → `/etc/mysql/mariadb.conf.d/`: `innodb_buffer_pool_size = 1G`, `innodb_log_file_size = 256M`, `innodb_io_capacity = 1000`, tabelas temporárias de 64 MB | Os dados (~50 MB, +17 MB/ano) ficam todos em memória; reiniciado só quando o ficheiro muda |
| API | `MemoryMax=1536M`, `NODE_OPTIONS=--max-old-space-size=1024` | Margem para os cálculos sobre todo o catálogo |
| Estratégias | Worker threads, um por núcleo (`api/src/services/strategyRuns.js`): o catálogo é dividido entre os workers | O cálculo das 4 estratégias passou de 4,9 s para 3,1 s e deixou de bloquear a API (BackTest, Comparar, WinnersLoosers, Promessas, melhor estratégia) |
| Swap | `/swapfile` de 2 GB (só se não houver swap), `vm.swappiness=10` | Margem contra falta de memória, sem trocar para disco em uso normal |
| Backups | 30 dias de dumps (antes 14) | O disco tem espaço de sobra |

Uso típico: MariaDB ~1,2 GB, API ~150 MB (picos de ~500 MB com os workers), motores Python ~150 MB enquanto correm; ficam ~5 GB livres. O motor de recolha continua a pedir um símbolo de cada vez ao Yahoo, de propósito: pedidos em paralelo aumentam o risco de limitação (HTTP 429) e a recolha completa já demora só ~1,5 minutos.

## Protecção do SSH (fail2ban)

O servidor aceita login SSH por palavra-passe (decisão do administrador). Até 8 nov. 2026 esteve exposto a milhares de tentativas automáticas por dia (8 446 falhadas num dia, a 3 nov. 2026, com nomes como `root`, `ubuntu` ou `admin`); desde então, uma firewall externa só deixa chegar à porta 22 os IPs de casa e do escritório do administrador. Para entrar a partir de outro sítio, é preciso primeiro acrescentar esse IP na firewall externa (ou usar a consola do fornecedor do VPS). O `fail2ban` (`deploy/fail2ban/stocks.local`, instalado pelo `install.sh`) bloqueia durante 1 hora o IP que falhe 5 vezes em 10 minutos, e os bloqueios repetidos duplicam, até uma semana. Usa regras `nftables` próprias, independentes da `ufw`.

Desde 4 nov. 2026, `deploy/ssh/10-stocks.conf` (instalado pelo `install.sh` em `/etc/ssh/sshd_config.d/`, validado com `sshd -t` antes de recarregar) proíbe o login directo do `root` (`PermitRootLogin no`: entra-se como `stocks` e usa-se `sudo`), reduz as tentativas por ligação para 3 e o tempo para autenticar para 30 s, e desliga o reencaminhamento de X11. O acesso por palavra-passe mantém-se. Para voltar a permitir o `root`, apagar a linha `PermitRootLogin` desse ficheiro e correr o `install.sh`.

### Outras afinações do servidor (4 nov. 2026)

- O serviço do Caddy tem protecção reforçada no systemd (`deploy/caddy/hardening.conf`, instalado pelo `install.sh` em `/etc/systemd/system/caddy.service.d/`): só escreve em `/var/lib/caddy` e `/var/log/caddy`, só tem a capacidade de abrir as portas 80 e 443 e não vê o resto do sistema (`systemd-analyze security caddy`: 1,7, antes 8,8).
- Serviços sem uso num VPS desligados: `ModemManager` e `fwupd` (mascarados), `udisks2`, `multipathd` e o temporizador `fwupd-refresh`. Para os repor: `sudo systemctl unmask ModemManager fwupd && sudo systemctl enable --now <serviço>`.
- `/home/stocks` com permissões 750 (só o utilizador `stocks` vê o repositório).
- O `install.sh` deixa `node_modules` e `frontend/dist` em `/opt/stocks` sempre de `root`.
- A conta `ubuntu` da imagem (sem palavra-passe nem chaves, nunca usada) foi apagada, com a regra de `sudo` do cloud-init (`/etc/sudoers.d/90-cloud-init-users`). O cloud-init está desligado e não a recria.

Para não se bloquear a si próprio, ponha o seu IP num ficheiro à parte (não versionado):

```bash
printf '[DEFAULT]\nignoreip = 127.0.0.1/8 ::1 <o-seu-ip>\n' | sudo tee /etc/fail2ban/jail.d/stocks-ignoreip.local
sudo systemctl restart fail2ban
sudo fail2ban-client status sshd        # IPs bloqueados e contagens
sudo fail2ban-client set sshd unbanip <ip>
```
