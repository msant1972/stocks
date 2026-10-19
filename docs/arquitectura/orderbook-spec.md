# Especificação — Módulo `euronext-orderbook`

| | |
|---|---|
| **Versão** | 0.1 (rascunho) |
| **Data** | 2026-10-19 |
| **Estado** | Para revisão |

---

## 1. Objetivo

Módulo que obtém o livro de ofertas (order book) de um instrumento cotado na Euronext a partir do endpoint público do site `live.euronext.com` e o apresenta ao utilizador, em consola e/ou numa vista web, com métricas derivadas (spread, mid, desequilíbrio).

## 2. Âmbito

**Dentro do âmbito**

- Ler o livro de ofertas de **um instrumento** identificado por `ISIN` + `MIC`.
- Normalizar a resposta num modelo de dados tipado.
- Calcular métricas básicas.
- Mostrar o livro em tabela (consola) e em gráfico de profundidade (web).
- Atualização periódica opcional.

**Fora do âmbito**

- Dados em tempo real (o endpoint tem **15 min de atraso**).
- Histórico, persistência ou séries temporais.
- Execução de ordens ou qualquer interação com corretoras.
- Pesquisa de instrumentos por nome/ticker.

## 3. Fonte de dados

### 3.1 Endpoint

```
GET https://live.euronext.com/{lang}/ajax/getOrderBookCanvas/{ISIN}-{MIC}
```

| Parâmetro | Exemplo | Regra |
|---|---|---|
| `lang` | `en` | Uma de `en, fr, nl, pt-pt, nb, de, it, el`. Por omissão `en` (afeta só textos do HTML). |
| `ISIN` | `PTFCP0AM0008` | 12 caracteres, regex `^[A-Z]{2}[A-Z0-9]{9}[0-9]$`, dígito de controlo válido (Luhn). |
| `MIC` | `XLIS` | 4 caracteres, regex `^[A-Z0-9]{4}$`. Ex.: `XLIS`, `XPAR`, `XAMS`, `XBRU`, `XMSM`, `XOSL`, `MTAA`. |

**Cabeçalhos a enviar**

| Cabeçalho | Valor |
|---|---|
| `User-Agent` | Identificação do módulo, p. ex. `euronext-orderbook/0.1` |
| `Accept` | `application/json` |
| `X-Requested-With` | `XMLHttpRequest` |

Não requer autenticação, cookies nem token.

> ⚠️ Endpoint **interno e não documentado**. Pode mudar sem aviso. O módulo deve falhar de forma explícita (ver §8) e não silenciosamente.

### 3.2 Contrato da resposta (observado)

`Content-Type: application/json`, objeto com três campos:

```json
{
  "chart_data": [
    { "price": "3.40", "qtt": "123" },
    { "price": "2.80", "qtt": "3000" },
    { "price": "2.56", "qtt": "-2440" },
    { "price": "2.50", "qtt": "-1000" }
  ],
  "table": "<div id=\"AwlOrderBookCanvas\"> … <table id=\"AwlOrderBookTableCanvas\"> … </div>",
  "chart": "<div> … HTML do contentor do gráfico … </div>"
}
```

| Campo | Tipo | Conteúdo |
|---|---|---|
| `chart_data` | array | Níveis de preço. **`qtt > 0` = venda (ask)**, **`qtt < 0` = compra (bid)**. `price` e `qtt` são **strings** com ponto decimal. Ordem observada: vendas por preço decrescente, depois compras por preço decrescente — **não depender desta ordem**. |
| `table` | string (HTML) | Tabela com colunas `# │ Shares │ Bid price │ Ask price │ Shares │ #`, onde `#` é o **número de ordens** por nível (não existe em `chart_data`). Contém também o carimbo `Updated DD/MM/YYYY - HH:MM` e os totais. |
| `chart` | string (HTML) | Só apresentação; ignorado pelo módulo. |

**Estrutura relevante de `table`**

- Linhas: `#AwlOrderBookTableCanvas tbody tr`, 6 `<td>` cada:
  `[0] nº ordens compra · [1] qtd compra · [2] preço compra · [3] preço venda · [4] qtd venda · [5] nº ordens venda`.
  Células vazias quando um dos lados tem menos níveis.
- Quantidades usam separador de milhares `,` (ex.: `12,272`).
- Carimbo: texto que corresponde a `Updated\s*(\d{2}/\d{2}/\d{4})\s*-\s*(\d{2}:\d{2})` — hora local do mercado (Europe/Lisbon para `XLIS`, Europe/Paris para a maioria dos restantes; ver §6.3).
- Totais: `.totalbar__left` (qtd compra), `.totalbar__right` (qtd venda), `.totalbar__bottom .text-l` / `.text-r` (nº ordens compra / venda).

**Profundidade**: até **10 níveis por lado** (observado).

**Livro vazio** (mercado fechado, instrumento suspenso, sem ordens): `chart_data` vazio ou ausente; tabela com `Content unavailable`. Deve produzir um `OrderBook` com listas vazias, **não** um erro.

### 3.3 Resposta cifrada (`ajax_secure`)

O site tem um filtro que, **se** a resposta vier no formato `{"ct": "...", "iv": "...", "s": "..."}`, a decifra com AES (formato CryptoJS/OpenSSL, passphrase → chave via `EVP_BytesToKey`/MD5). A passphrase é pública em `drupalSettings.ajax_secure.kye` na página `/{lang}/popout-page/getOrderBook/{ISIN}-{MIC}`.

À data, **este endpoint responde em claro**. O módulo:

1. Deteta o formato cifrado (presença de `ct`, `iv`, `s`).
2. Se detetado → levanta `EncryptedResponseError` (v0.1). Suporte a decifração fica como evolução (§12), para não acoplar o módulo a esse mecanismo antes de ser necessário.

## 4. Modelo de dados

Notação neutra (tipo TypeScript); implementar com os tipos idiomáticos da linguagem escolhida. Preços como **decimal** (não `float`) para evitar erros de arredondamento.

```ts
type Side = "bid" | "ask";

interface Level {
  side: Side;
  price: Decimal;       // > 0
  quantity: number;     // inteiro > 0 (valor absoluto de qtt)
  orders: number | null;// nº de ordens; null se não for possível extrair da tabela
}

interface OrderBook {
  isin: string;
  mic: string;
  bids: Level[];        // ordenado por preço DEcrescente (melhor primeiro)
  asks: Level[];        // ordenado por preço Crescente (melhor primeiro)
  updatedAt: Date | null;   // carimbo "Updated", convertido para UTC
  fetchedAt: Date;          // hora local do pedido, UTC
  delayMinutes: 15;
  source: string;           // URL usado
}

interface OrderBookStats {
  bestBid: Decimal | null;
  bestAsk: Decimal | null;
  spread: Decimal | null;        // bestAsk − bestBid
  spreadPct: number | null;      // spread / mid
  mid: Decimal | null;           // (bestBid + bestAsk) / 2
  bidVolume: number;             // Σ quantity bids
  askVolume: number;             // Σ quantity asks
  bidNotional: Decimal;          // Σ price × quantity bids
  askNotional: Decimal;          // Σ price × quantity asks
  imbalance: number | null;      // (bidVolume − askVolume) / (bidVolume + askVolume), em [−1, 1]
  bidOrders: number | null;
  askOrders: number | null;
  crossed: boolean;              // bestBid ≥ bestAsk (leilão / dados inconsistentes)
}
```

## 5. Regras de parsing

1. `chart_data` é a **fonte principal** de preço e quantidade.
2. Para cada elemento: `q = parseDecimal(qtt)`; ignorar `q == 0`; `side = q > 0 ? "ask" : "bid"`; `quantity = |q|`.
3. `price` e `qtt` com `.` decimal, sem separador de milhares — usar parsing **independente da cultura** (invariant).
4. Ordenar: `bids` por preço desc., `asks` por preço asc.
5. Nº de ordens: ler `table` com um parser de HTML (não regex), e associar por **(lado, preço)** — coluna 0 ↔ preço da coluna 2 (bid), coluna 5 ↔ preço da coluna 3 (ask). Se a associação falhar, `orders = null` e emitir aviso, sem falhar.
6. Validação cruzada: se `table` tiver totais, comparar com `Σ quantity` de cada lado; divergência → aviso (`OrderBookInconsistencyWarning`), não erro.
7. Entradas malformadas (preço ≤ 0, valor não numérico) → descartar o nível e emitir aviso.
8. Campos extra desconhecidos na resposta → ignorar.

## 6. Interface do módulo

### 6.1 API

```ts
fetchOrderBook(isin: string, mic: string, opts?: FetchOptions): Promise<OrderBook>
computeStats(book: OrderBook): OrderBookStats
renderText(book: OrderBook, stats?: OrderBookStats, opts?: RenderOptions): string
watchOrderBook(isin, mic, intervalSec, onUpdate: (b: OrderBook) => void, opts?): Stoppable
```

```ts
interface FetchOptions {
  lang?: string;            // "en"
  timeoutMs?: number;       // 10_000
  retries?: number;         // 2 (só em erros de rede e HTTP 5xx/429)
  userAgent?: string;
  baseUrl?: string;         // "https://live.euronext.com" (permite mocks em testes)
}

interface RenderOptions {
  levels?: number;          // nº máx. de níveis por lado (omissão: todos)
  layout?: "side-by-side" | "ladder";
  locale?: string;          // formatação de números na saída (omissão: "pt-PT")
}
```

- `watchOrderBook`: intervalo **mínimo 30 s** (forçado; valores menores são elevados para 30). Só chama `onUpdate` quando o conteúdo mudou (comparar hash de `bids`+`asks`+`updatedAt`). Erros transitórios não param o ciclo; são reportados via callback `onError`.

### 6.2 CLI

```
orderbook <ISIN> <MIC> [--levels N] [--json] [--watch SEG] [--lang en]
```

| Opção | Efeito |
|---|---|
| `--json` | Imprime `{ book, stats }` em JSON (preços como string para preservar precisão). |
| `--levels N` | Limita níveis mostrados. |
| `--watch SEG` | Atualiza a cada `SEG` segundos (mín. 30). Limpa o ecrã entre atualizações. |

Códigos de saída: `0` OK · `2` argumentos inválidos · `3` instrumento sem dados / não encontrado · `4` erro de rede/HTTP · `5` resposta em formato inesperado.

### 6.3 Fusos horários

O carimbo `Updated` vem em hora local do mercado, sem fuso. Mapeamento por MIC:

| MIC | Fuso |
|---|---|
| `XLIS` | `Europe/Lisbon` |
| `XDUB` (Euronext Dublin) | `Europe/Dublin` |
| restantes (`XPAR`, `XAMS`, `XBRU`, `XMSM`, `XOSL`, `MTAA`, …) | `Europe/Paris` (ou equivalente CET/CEST) |

> A confirmar: se o site usa sempre a hora do mercado ou a de Paris. Validar comparando com a página do instrumento durante a sessão.

## 7. Apresentação

### 7.1 Consola — layout `side-by-side` (omissão)

```
PTFCP0AM0008 · XLIS · atualizado 19/10/2026 16:40 (atraso 15 min)

  #   Qtd compra   Compra │ Venda   Qtd venda   #
  2        2 440    2,560 │ 2,800       3 000   1
  1        1 000    2,500 │ 2,820       2 000   1
                          │ 2,860      12 272   2
                          │ …
 ─────────────────────────┼──────────────────────
  3        3 440          │            36 990  15

Spread 0,240 (8,96 %) · Mid 2,680 · Desequilíbrio −0,83 (pressão vendedora)
```

- Compras a verde, vendas a vermelho quando o terminal suporta cor (desligar com `NO_COLOR`).
- Número de casas decimais do preço = máximo observado no livro (mín. 2).
- Se `crossed = true`, mostrar aviso `LIVRO CRUZADO (provável leilão)`.
- Livro vazio: `Sem ofertas disponíveis para PTFCP0AM0008-XLIS.`

### 7.2 Layout `ladder`

Uma coluna de preços, vendas em cima (pior → melhor), linha de spread, compras em baixo (melhor → pior), com barra horizontal proporcional à quantidade.

### 7.3 Web (opcional, v0.2)

- Tabela igual a 7.1 + gráfico de profundidade **cumulativa** (degrau): eixo X preço, eixo Y quantidade acumulada; compras à esquerda do mid, vendas à direita.
- Cabeçalho com `bestBid`, `bestAsk`, spread, mid, desequilíbrio e carimbo com o aviso de atraso sempre visível.
- Atualização via `watchOrderBook` (≥ 30 s); indicar "a atualizar…" e manter os dados anteriores em caso de erro, com indicação de dados desatualizados.
- Não carregar a página da Euronext no browser do cliente (CORS): o pedido é feito pelo backend do módulo.

## 8. Erros

| Situação | Comportamento |
|---|---|
| ISIN/MIC inválido (formato ou dígito de controlo) | `InvalidInstrumentError`, sem pedido HTTP. |
| HTTP 404 ou HTML em vez de JSON | `InstrumentNotFoundError`. |
| HTTP 429 / 5xx / timeout / falha de rede | Retentar até `retries` com backoff exponencial (1 s, 2 s, 4 s ± jitter); depois `UpstreamError`. |
| JSON sem `chart_data` **e** sem `table` | `UnexpectedFormatError` (incluir excerto truncado da resposta, máx. 500 caracteres). |
| Formato cifrado (`ct`/`iv`/`s`) | `EncryptedResponseError`. |
| Inconsistências não fatais (§5.6, §5.7) | Aviso no logger, resultado devolvido. |

Todos os erros incluem `isin`, `mic` e `url`.

## 9. Requisitos não funcionais

- **Cortesia com a fonte**: no máximo 1 pedido / 30 s por instrumento por processo; cache em memória com TTL 30 s partilhada entre chamadas a `fetchOrderBook`.
- **Desempenho**: parsing < 50 ms para uma resposta típica (~20 KB).
- **Dependências**: cliente HTTP + parser HTML + biblioteca decimal. Nada de browser headless.
- **Logs**: nível `debug` com URL, status, duração; nunca registar a resposta completa em `info`.
- **Configuração** por variáveis de ambiente: `EURONEXT_BASE_URL`, `EURONEXT_LANG`, `EURONEXT_TIMEOUT_MS`, `EURONEXT_USER_AGENT`.

## 10. Testes

**Unitários (sem rede)**, com fixtures gravadas:

| Fixture | Verifica |
|---|---|
| `ptfcp0am0008-xlis.json` (resposta de 19/10/2026 16:40) | 2 bids, 10 asks; bestBid 2.56, bestAsk 2.80; spread 0.24; bidVolume 3 440; askVolume 36 990; bidOrders 3; askOrders 15; ordens por nível (ex.: ask 3.00 → 3). |
| `empty.json` | Listas vazias, stats com `null`, sem exceção. |
| `one-sided-asks.json` / `one-sided-bids.json` | Spread/mid `null`; render mostra só um lado. |
| `crossed.json` | `crossed = true`, aviso no render. |
| `malformed-level.json` | Nível descartado + aviso; restantes preservados. |
| `table-mismatch.json` | Totais divergentes → aviso; `orders = null` onde não associável. |
| `encrypted.json` | `EncryptedResponseError`. |
| `html-error.html` | `InstrumentNotFoundError`. |

Também: validação de ISIN (casos válidos/inválidos de Luhn), parsing invariante à cultura (correr com locale `pt-PT`), ordenação, intervalo mínimo de `watch`, backoff com relógio simulado.

**Teste de contrato (com rede, opcional, não corre em CI por omissão)**: pede `PTFCP0AM0008-XLIS` e verifica só a **forma** da resposta (campos e tipos), não valores.

## 11. Aspetos legais

- Dados com 15 min de atraso, propriedade da Euronext. Uso sujeito aos [Termos de Uso](https://www.euronext.com/terms-use); redistribuição ou uso comercial pode exigir licença de dados.
- Mostrar sempre a fonte ("Fonte: Euronext, atraso 15 min") em qualquer saída visível.

## 12. Evoluções futuras

1. Decifrar respostas `ajax_secure` (ler a passphrase de `drupalSettings` na página popout).
2. Vários instrumentos em paralelo, respeitando o limite de pedidos.
3. Exportar instantâneos para CSV/Parquet para análise.
4. Vista web (§7.3) com gráfico de profundidade.
5. Resolver ISIN a partir de ticker/nome através da pesquisa do site.

## 13. Questões em aberto

- O carimbo `Updated` está em hora do mercado ou de Paris? (§6.3)
- Profundidade máxima é sempre 10 por lado, ou varia por mercado/segmento?
- Comportamento do endpoint durante leilões de abertura/fecho (preço teórico de equilíbrio aparece?).
- Há limitação de pedidos (rate limit) do lado da Euronext? Qual o limiar?
