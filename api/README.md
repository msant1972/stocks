# API

Middleware da aplicação, em Node.js 22 com Fastify. Valida os pedidos com Zod e acede ao MariaDB com mysql2, em SQL directo. O esquema é gerido pelas migrações dbmate de `db/migrations/`, partilhadas com os motores Python.

O contrato está em [openapi.yaml](openapi.yaml), gerado a partir das rotas com `npm run openapi`. Com a API a correr, a documentação interactiva fica em `/api/docs`.

## Instalação

```bash
cd api
npm ci
```

A configuração vem de variáveis de ambiente. Em desenvolvimento, as scripts `npm` lêem o ficheiro `.env` da raiz do repositório, se existir.

| Variável | Omissão | Descrição |
|---|---|---|
| `STOCKS_DB_HOST`, `STOCKS_DB_PORT`, `STOCKS_DB_USER`, `STOCKS_DB_NAME` | `127.0.0.1`, `3306`, `stocks`, `stocks` | Base de dados |
| `STOCKS_DB_PASSWORD` | obrigatória | |
| `STOCKS_API_HOST`, `STOCKS_API_PORT` | `127.0.0.1`, `3000` | Endereço de escuta (atrás do proxy HTTPS) |
| `STOCKS_PUBLIC_ORIGIN` | — | Ex.: `https://stocks.graus.pt`. Activa cookies `Secure` e recusa pedidos de escrita vindos de outra origem |
| `STOCKS_INITIAL_CAPITAL` | `10000.00` | Capital virtual das contas novas, em EUR |
| `STOCKS_MAX_QUOTE_AGE_DAYS` | `7` | Dias de calendário a partir dos quais a última cotação está desactualizada e as operações são recusadas |
| `STOCKS_SESSION_DAYS` | `7` | Validade da sessão, renovada com o uso |
| `STOCKS_LOGIN_MAX_ATTEMPTS` | `10` | Tentativas de login por IP em 15 minutos |
| `STOCKS_FRONTEND_DIST` | — | Pasta do frontend compilado; se definida, a API serve-o |

## Utilização

```bash
npm run cli -- create-user --email ana@exemplo.pt --name "Ana"   # pede a palavra-passe sem eco
npm run cli -- list-users
npm run dev                                                      # API em http://127.0.0.1:3000
```

Outros comandos: `set-password`, `disable-user` e `enable-user`, todos com `--email`.

## Regras implementadas

- **Sessões:** cookie `HttpOnly` e `SameSite=Strict`. Na BD guarda-se só o SHA-256 do token. As palavras-passe usam scrypt com os parâmetros da OWASP. Alterar a palavra-passe ou desactivar a conta termina todas as sessões.
- **Catálogo:** os símbolos novos ficam no estado `pending` e geram um pedido em `fetch_jobs`. O motor de recolha confirma que o símbolo existe e que a moeda é EUR. A importação aceita `.xlsx` ou `.csv` (até 1 MB e 1000 linhas). Lê a coluna `ticker` e mostra uma pré-visualização antes de gravar.
- **Simulação:**
  - o preço é o último fecho não ajustado;
  - a compra está limitada ao saldo e a venda à quantidade detida;
  - o custo é calculado pelo custo médio ponderado;
  - saldo, posição, operação e movimento são actualizados numa só transacção, com a carteira bloqueada (`SELECT … FOR UPDATE`);
  - a chave de idempotência impede operações duplicadas;
  - se a cotação mudou desde a pré-visualização, a API responde `409 PRICE_CHANGED`.
- **Valores monetários:** circulam como strings decimais e são calculados com BigInt, sem passar por vírgula flutuante.

## Testes

```bash
STOCKS_TEST_DB_PASSWORD=... npm test   # usa a base stocks_test, cujas tabelas são recriadas
```
