# Motor de recolha de cotações

Recolhe cotações diárias através do yfinance e grava-as no MariaDB. Esta é a prova de conceito da fase F2 do plano.

## O que faz

- **Carga inicial:** quando um símbolo é adicionado, fica no estado `pending` e é criado um pedido em `fetch_jobs`. O motor consulta o fornecedor e grava os últimos três anos de sessões (`STOCKS_HISTORY_YEARS`), para a SMA200 estar completa nos dois anos mostrados. Depois marca o instrumento como `active`, ou como `invalid` se a moeda não for EUR ou se o símbolo não existir.
- **Actualização diária:** `update` pede uma recolha para cada instrumento activo. Cada recolha volta a ler os últimos 7 dias, para apanhar correcções do fornecedor.
- **Sem duplicações:** a chave primária é (instrumento, data de sessão) e a gravação usa `INSERT ... ON DUPLICATE KEY UPDATE`.
- **Falhas:** as falhas de rede e de limite de pedidos voltam à fila com espera progressiva (2, 4, 8... minutos), até 5 tentativas. Uma falha num instrumento não interrompe os restantes. Uma falha de rede nunca invalida um instrumento.
- **Vários processos:** os pedidos são reservados com `SELECT ... FOR UPDATE SKIP LOCKED`, e o mesmo instrumento nunca é recolhido por dois processos ao mesmo tempo.
- **Preços:** `close` é o fecho não ajustado, usado nas operações simuladas. `adj_close` é o fecho ajustado, usado nos gráficos.
- **Retenção:** não se apaga nada. Os três anos definem apenas a profundidade da carga inicial.

O yfinance fica isolado em `fetcher/provider.py`, atrás da interface `QuoteProvider`, para poder ser substituído por outro fornecedor.

## Instalação

Requer Python 3.11 ou superior e MariaDB 10.6 ou superior (por causa do `SKIP LOCKED`).

```bash
cd engines/fetcher
python3 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
```

Base de dados: aplicar as migrações de `db/migrations/`. Os ficheiros seguem o formato do [dbmate](https://github.com/amacneil/dbmate), proposto como ferramenta única de migrações para a API e para os motores:

```bash
export DATABASE_URL="mysql://stocks:PASSWORD@127.0.0.1:3306/stocks"
dbmate --migrations-dir ../../db/migrations up
```

Configuração por variáveis de ambiente: `STOCKS_DB_HOST`, `STOCKS_DB_PORT`, `STOCKS_DB_USER`, `STOCKS_DB_PASSWORD` (obrigatória) e `STOCKS_DB_NAME`.

## Utilização

```bash
python -m fetcher add --file seeds/instrumentos_iniciais.txt   # lista inicial (41 símbolos)
python -m fetcher add ASML.AS SIE.DE                          # símbolos avulsos
python -m fetcher run                                         # processa os pedidos pendentes
python -m fetcher update                                      # actualização diária (fechos definitivos)
python -m fetcher update --intraday                           # actualização durante a sessão (provisória)
python -m fetcher status                                      # cobertura e estado de cada instrumento
python -m fetcher indicators                                  # recalcula EMA9 e SMA10/50/125/200
python -m fetcher backfill                                    # completa o histórico dos activos até STOCKS_HISTORY_YEARS
```

## Agendamento proposto (systemd)

- `stocks-fetcher-run.timer`: corre `python -m fetcher run` a cada 5 minutos, para processar as cargas iniciais pedidas pela aplicação.
- `stocks-intraday.timer`: corre `python -m fetcher update --intraday` de segunda a sexta, de hora a hora das 08:00 às 17:00 de Lisboa, durante as sessões; a vela do próprio dia é provisória.
- `stocks-daily.timer`: corre `python -m fetcher update` (e depois os alertas) de segunda a sexta às 19:00 de Lisboa, depois do fecho das bolsas europeias (17:30 CET), gravando os fechos definitivos.

## Testes

```bash
STOCKS_TEST_DB_PASSWORD=... pytest   # base de dados de testes: stocks_test (as tabelas são recriadas)
```

Os testes usam um fornecedor simulado e nunca contactam o Yahoo. Sem `STOCKS_TEST_DB_PASSWORD`, os testes de base de dados são ignorados.
