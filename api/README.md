# API

Middleware da aplicação, em Node.js 22 com Fastify. Valida os pedidos com Zod e acede ao MariaDB com mysql2, em SQL directo. O esquema é gerido pelas migrações dbmate de `db/migrations/`, partilhadas com os motores Python.

O contrato está em [openapi.yaml](openapi.yaml), gerado a partir das rotas com `npm run openapi`. Com a API a correr, a documentação interactiva fica em `/api/docs` (só com sessão completa; sem ela responde 401).

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
| `STOCKS_MAX_QUOTE_AGE_DAYS` | `7` | Dias de calendário a partir dos quais a última cotação está desactualizada e as operações são recusadas |
| `STOCKS_SESSION_DAYS` | `7` | Validade da sessão, renovada com o uso |
| `STOCKS_LOGIN_MAX_ATTEMPTS` | `10` | Tentativas de login por IP em 15 minutos |
| `STOCKS_FRONTEND_DIST` | — | Pasta do frontend compilado; se definida, a API serve-o |
| `STOCKS_SECRET_KEY` | ficheiro `/etc/stocks/secret.key` | Chave AES-256 (32 bytes em base64) que cifra a palavra-passe SMTP e os segredos TOTP; obrigatória para a autenticação em dois passos |

## Utilização

```bash
npm run cli -- create-user --email ana@exemplo.pt --name "Ana"   # pede a palavra-passe sem eco
npm run cli -- list-users
npm run dev                                                      # API em http://127.0.0.1:3000
```

Outros comandos: `set-password`, `set-email` (com `--new-email`), `disable-user`, `enable-user` e `reset-mfa` (desliga o 2.º factor, que é configurado de novo no próximo login), todos com `--email`.

## Livro de ofertas (CLI)

Módulo `src/orderbook/`, segundo [docs/arquitectura/orderbook-spec.md](../docs/arquitectura/orderbook-spec.md):

```bash
npm run orderbook -- PTFCP0AM0008 XLIS                 # tabela lado a lado
npm run orderbook -- PTFCP0AM0008 XLIS --layout ladder --levels 5
npm run orderbook -- PTFCP0AM0008 XLIS --json          # { book, stats }, preços como string
npm run orderbook -- PTFCP0AM0008 XLIS --watch 60      # actualiza a cada 60 s (mínimo 30)
```

Códigos de saída: 0 OK, 2 argumentos inválidos, 3 sem dados ou não encontrado, 4 rede/HTTP, 5 formato inesperado. Configuração: `EURONEXT_BASE_URL`, `EURONEXT_LANG`, `EURONEXT_TIMEOUT_MS`, `EURONEXT_USER_AGENT`; `NO_COLOR` desliga as cores. Teste de contrato com rede: `EURONEXT_CONTRACT=1 npx vitest run test/orderbook.contract.test.js`.

## Regras implementadas

- **Sessões:** cookie `HttpOnly` e `SameSite=Strict`. Na BD guarda-se só o SHA-256 do token. As palavras-passe usam scrypt com os parâmetros da OWASP. Alterar a palavra-passe ou desactivar a conta termina todas as sessões. Cada login apaga as sessões expiradas de todos os utilizadores.
- **Limites de tentativas:** por IP (login: `STOCKS_LOGIN_MAX_ATTEMPTS`, 10 em 15 min; rotas do 2.º factor: 20 em 15 min) e por conta, contados no `audit_log` (índice `ix_audit_action`): 20 palavras-passe erradas por email em 15 min → `429 LOGIN_THROTTLED` (conta-se pelo email, exista ou não a conta, sem verificar a palavra-passe); 10 códigos errados por conta em 15 min, somando todas as sessões → `429 MFA_THROTTLED`.
- **Autenticação em dois passos (obrigatória):** o login cria uma sessão restrita de 15 minutos (`mfa_verify` ou `mfa_setup`), que só chega às rotas com `config: { mfa: 'allow' }`; as outras respondem `401 MFA_REQUIRED`, ou `403 MFA_SETUP_REQUIRED` numa sessão completa de uma conta sem 2.º factor. TOTP em `src/auth/totp.js` (RFC 6238, sem dependências); segredo cifrado com a chave de `STOCKS_SECRET_KEY`/`/etc/stocks/secret.key`; códigos de uso único; 10 códigos de recuperação (SHA-256); 5 códigos errados terminam a sessão restrita. Nos testes, `login()` completa o 2.º passo com um segredo fixo.
- **Catálogo:** os símbolos novos ficam no estado `pending` e geram um pedido em `fetch_jobs`. O motor de recolha confirma que o símbolo existe e que a moeda é EUR. A importação aceita `.xlsx` ou `.csv` (até 1 MB e 1000 linhas). Lê a coluna `ticker` e mostra uma pré-visualização antes de gravar.
- **Carteira:** é a conta de simulação da SAXO Bank (`src/saxo/`); a API guarda o valor da conta em cada sessão, para o gráfico da evolução (`src/saxo/history.js`).
- **Correspondência com a SAXO** (`saxo_instruments`, partilhada por todos os utilizadores e pela Automação): `POST /saxo/instruments/:id/match` aceita qualquer instrumento da SAXO a um administrador; aos restantes, só um dos candidatos propostos (`SAXO_AMBIGUOUS`) de um instrumento ainda sem ligação (senão 403).
- **Automação** (`src/saxo/automation.js`): corre ao minuto 23 de cada hora de 08:23 a 16:23 (a recolha do Yahoo é ao minuto 20), só nos instrumentos da lista do utilizador e cada um pela sua melhor estratégia nas compras (as vendas valem sempre), e nunca envia ordens depois das 16:35; a venda de uma estratégia é o que ela comprou (executado) menos as vendas executadas e as ainda abertas, no máximo o que a conta tem, descontando as vendas de outras estratégias na mesma execução.
- **Estratégias ligadas** (`src/services/strategySettings.js`, tabela `strategy_settings`): `PUT /strategies/{id}/enabled` (administradores) liga e desliga cada estratégia para todos os módulos; `/backtest`, `/signals`, `/strategies/compare`, `/strategies/best` e `/winners-losers` só usam as ligadas (`STRATEGY_DISABLED`, 409, para uma desligada); as Promessas usam `ANALYSIS_STRATEGIES`.
- **BackTest com custos e período de verificação:** `?costs=true` e `?period=verification` em `/backtest` e `/strategies/compare` (`shared/costs.js`; o período de verificação precisa dos 5 anos de histórico e tem cache de 6 h).
- **Laboratório** (`src/routes/experiments.js`): registo das experiências; **cópias de segurança** (`src/routes/backups.js`, administradores): listar, criar com o `deploy/bin/backup.sh` e descarregar, auditado, sem restauro pela API (`STOCKS_BACKUP_DIR`, `STOCKS_BACKUP_SCRIPT`).
- **Carteira SAXO:** as posições abertas trazem `openedAt` (`ExecutionTimeOpen`), usado pelo botão «Posições» do Charts; «Vender Tudo» usa as ordens normais (`POST /saxo/orders`, a mercado), sem rota própria.
- **Registos:** sem cookies nem cabeçalho `Authorization`; o endereço do retorno OAuth da SAXO aparece sem a query (código de autorização e `state`).
- **Valores monetários:** circulam como strings decimais e são calculados com BigInt, sem passar por vírgula flutuante.
- **Estratégias e análises** (`src/routes/backtest.js`, `src/routes/signals.js`): o código das estratégias está em `shared/strategies/` (registo em `index.js`). `GET /strategies`, `GET /backtest?strategy=`, `GET /winners-losers` e `GET /promessas` partilham os resultados do BackTest, guardados 10 minutos por estratégia; `GET /signals?strategy=` tem cache própria.
- **Memória:** estes cálculos percorrem o catálogo **um instrumento de cada vez** (uma consulta por instrumento, cotações descartadas a seguir), calculam numa só passagem todas as estratégias em falta e servem pedidos simultâneos com o mesmo cálculo; a cache dos Sinais guarda só as últimas 20 sessões. Carregar todas as cotações de uma vez (cerca de 224 000 sessões por estratégia) esgotou o heap da API (cerca de 256 MB com `MemoryMax=512M`) a 24 out. 2026 e deu 502; com o modelo actual, o pico é de cerca de 44 MB com sete pedidos simultâneos. Qualquer novo cálculo sobre o catálogo deve seguir o mesmo modelo.

## Testes

```bash
STOCKS_TEST_DB_PASSWORD=... npm test   # usa a base stocks_test, cujas tabelas são recriadas
```
