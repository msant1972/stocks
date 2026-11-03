# Implantação

Toda a aplicação corre num único servidor Ubuntu, `stocks.graus.pt`. Desde 2 nov. 2026 é um VPS com Ubuntu (26.04), instalado de raiz com este procedimento.

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
| `stocks-backup.timer` | diariamente, 03:30 UTC | `mariadb-dump` para `/var/backups/stocks`, guardado durante 14 dias |
| `stocks-ops.timer` | dias úteis, 21:00 de Lisboa | Aviso operacional por email aos administradores (`alerts ops`): execuções falhadas ou presas, recolha diária em falta, instrumentos com recolha falhada, dados parados; no máximo um email por dia |
| `stocks-analysis.timer` | sábado, 09:00 de Lisboa | Recalcula a validação das Promessas e a persistência dos ganhadores (`scripts/analysis-revalidation.mjs`, tabela `analysis_results`) |

Os serviços correm com o utilizador de sistema `stocks-svc` (sem login nem sudo), com o sistema de ficheiros só de leitura (`ProtectSystem=strict`). A configuração e os segredos ficam em `/etc/stocks/stocks.env` (`root:stocks-svc`, modo 640). A chave que cifra os segredos guardados na BD (palavra-passe SMTP) fica em `/etc/stocks/secret.key`, criada pelo `install.sh` e nunca substituída: perdê-la obriga a voltar a introduzir a palavra-passe SMTP.

## Pré-requisitos

- Ubuntu com acesso `sudo`.
- A timezone do sistema em Lisboa, para que os registos (`journalctl`), as listas de timers e as horas da base de dados mostrem a hora de Lisboa. Os horários dos timers já indicam `Europe/Lisbon` (e o backup UTC), e a API e os alertas trabalham em UTC, por isso o funcionamento não depende disto. Se o MariaDB já estiver instalado, reinicie-o (e a API) para assumir a nova timezone:
  ```bash
  sudo timedatectl set-timezone Europe/Lisbon
  sudo systemctl restart mariadb stocks-api   # só se já estiverem instalados
  ```
- O DNS de `stocks.graus.pt` a apontar para o IP público do servidor.
- As portas **80 e 443** abertas na firewall: o Caddy precisa delas para obter o certificado. A 3000 e a 3306 não devem ser abertas (a API e o MariaDB só escutam em `127.0.0.1`). No servidor actual, a firewall `ufw` só aceita ligações de entrada nas portas 22/tcp (SSH), 80/tcp, 443/tcp e 443/udp (HTTP/3); as de saída são livres (Yahoo, Euronext, SMTP, GitHub):
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

Depois de aumentar `STOCKS_HISTORY_YEARS` (hoje 3 por omissão), completar o histórico dos instrumentos já existentes:

```bash
sudo -u stocks-svc bash -c 'set -a; . /etc/stocks/stocks.env; cd /opt/stocks/engines/fetcher && .venv/bin/python -m fetcher backfill'
```

Faz um pedido ao Yahoo por instrumento (alguns minutos para cerca de 300); os pedidos que falharem são repetidos pelo timer de 5 minutos. As sessões existentes são actualizadas, sem duplicados.

O SMTP configura-se em **Definições → Envio de email (SMTP)** (administradores), com botão para enviar um email de teste. As variáveis `STOCKS_SMTP_*` só são usadas se não houver configuração em Definições. Sem nenhuma das duas, os alertas correm em `--dry-run`: os emails aparecem só no `journalctl -u stocks-daily` e não são enviados.

## Cópias de segurança e recuperação

Cópias:

1. **Dumps diários** (`stocks-backup.timer`, 03:30 UTC) em `/var/backups/stocks`, guardados 14 dias. São consistentes, porque são feitos com `mariadb-dump --single-transaction`.
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
