# Implantação

Toda a aplicação corre num único servidor Ubuntu, `stocks.graus.pt`:

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
| `stocks-daily.timer` | dias úteis, 19:00 de Lisboa | Actualização das cotações e, a seguir, alertas ([bin/daily.sh](bin/daily.sh)) |
| `stocks-backup.timer` | diariamente, 03:30 UTC | `mariadb-dump` para `/var/backups/stocks`, guardado durante 14 dias |

Os serviços correm com o utilizador de sistema `stocks`, com o sistema de ficheiros só de leitura (`ProtectSystem=strict`). A configuração e os segredos ficam em `/etc/stocks/stocks.env` (`root:stocks`, modo 640). A chave que cifra os segredos guardados na BD (palavra-passe SMTP) fica em `/etc/stocks/secret.key`, criada pelo `install.sh` e nunca substituída: perdê-la obriga a voltar a introduzir a palavra-passe SMTP.

## Pré-requisitos

- Ubuntu com acesso `sudo`.
- O DNS de `stocks.graus.pt` a apontar para o IP público do servidor.
- As portas **80 e 443** abertas no *security group* da AWS: o Caddy precisa delas para obter o certificado. A porta 22 deve ficar restrita aos IPs de administração. A 3000 e a 3306 não devem ser abertas.
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
sudo -u stocks bash -c 'set -a; . /etc/stocks/stocks.env; cd /opt/stocks/api && node src/cli.js create-user --email miguel@graus.pt --name "Miguel" --admin'
```

Carregar a lista inicial de instrumentos:

```bash
sudo -u stocks bash -c 'set -a; . /etc/stocks/stocks.env; cd /opt/stocks/engines/fetcher && .venv/bin/python -m fetcher add --file seeds/instrumentos_iniciais.txt && .venv/bin/python -m fetcher run'
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

O SMTP configura-se em **Definições → Envio de email (SMTP)** (administradores), com botão para enviar um email de teste. As variáveis `STOCKS_SMTP_*` só são usadas se não houver configuração em Definições. Sem nenhuma das duas, os alertas correm em `--dry-run`: os emails aparecem só no `journalctl -u stocks-daily` e não são enviados.

## Cópias de segurança e recuperação

Há dois níveis de cópia:

1. **Dumps diários** (`stocks-backup.timer`, 03:30 UTC) em `/var/backups/stocks`, guardados 14 dias. São consistentes, porque são feitos com `mariadb-dump --single-transaction`.
2. **Snapshots EBS** do volume do servidor, geridos na AWS (frequência e retenção definidas na consola ou no Data Lifecycle Manager). Protegem contra a perda do servidor e incluem os dumps do ponto 1.

O restauro foi testado a 18 out. 2026. Repita o teste periodicamente, por exemplo uma vez por trimestre.

**Recuperar a partir de um snapshot EBS.** Um snapshot do volume é «crash-consistent»: os ficheiros do MariaDB podem não estar num estado consistente. Use antes o dump mais recente que o snapshot contém:

1. Na AWS, criar um volume a partir do snapshot e anexá-lo a uma instância (a própria ou uma nova).
2. Montar o volume, por exemplo em `/mnt/recuperacao`, e localizar `/mnt/recuperacao/var/backups/stocks/stocks-<data>.sql.gz`.
3. Restaurar esse dump com o procedimento abaixo.

Se for preciso reconstruir o servidor inteiro, basta lançar uma instância a partir do snapshot: o sistema, a configuração (`/etc/stocks`, incluindo `secret.key`) e o código (`/opt/stocks`) vêm com ele. Depois restaure o dump para garantir uma base de dados consistente.

Restaurar, depois de parar a API e os timers:

```bash
sudo systemctl stop stocks-api stocks-fetcher-run.timer stocks-daily.timer
gunzip -c /var/backups/stocks/stocks-<data>.sql.gz | sudo mariadb stocks
sudo systemctl start stocks-api stocks-fetcher-run.timer stocks-daily.timer
```

Teste o restauro periodicamente numa base separada, por exemplo `stocks_restore`.

## Reverter uma publicação

1. `git checkout <versão anterior>` e `sudo deploy/install.sh`.
2. As migrações não são revertidas automaticamente. Se a versão anterior não for compatível com o esquema actual, avalie `dbmate rollback`; se for preciso restaurar uma cópia, aceite e reconcilie as escritas posteriores.
3. Valide saldos, posições, recolhas e alertas antes de retomar os timers.
