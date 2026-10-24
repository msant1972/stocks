# Promessas — método e validação

> Módulo Promessas (24 out. 2026): lista os instrumentos que, nos últimos 3 meses, mostram os sinais que no passado anunciaram ganhadores nos 12 meses seguintes. Código em `shared/promessas.js` (cálculo) e `GET /api/v1/promessas` (API). Estatística sobre dados passados; não é uma previsão segura nem uma recomendação de investimento.

## Pergunta

Os ganhadores do passado podem não continuar a ser ganhadores. Que sinais, observáveis hoje, indicaram no passado os instrumentos que viriam a ganhar nas três estratégias (A-Momentum, B-Opus e C-AI) e a subir nos 12 meses seguintes?

## Método de investigação

- Dados: 293 instrumentos do catálogo com histórico suficiente, cotações diárias de out. 2023 a out. 2026, fecho ajustado.
- Para cada data de teste T, os sinais de cada instrumento foram calculados **só com os dados até T**; o resultado foi medido depois de T: se as três estratégias, a começar sem posição em T, terminaram com ganho («ganhador nas 3») e o rendimento de comprar e manter.
- Cinco janelas: listas feitas em 23 out. 2025, 23 jan. 2026 e 23 abr. 2026, com resultados medidos a 6, 9 ou 12 meses (até 23 out. 2026). Com três anos de dados as janelas sobrepõem-se; não são independentes.

## O que os dados mostraram

Correlação de cada sinal em 23 out. 2025 com o rendimento dos 12 meses seguintes (Spearman, 293 instrumentos):

| Sinal | Correlação | Rendimento do terço inferior / superior |
|---|---|---|
| M2 (momento 12-1 / volatilidade) | 0,16 | +7% / +17% |
| SMA50 acima da SMA200 (distância) | 0,14 | +7% / +19% |
| Inclinação da SMA200 em 3 meses | 0,14 | +8% / +18% |
| Rendimento de 12 meses | 0,13 | +8% / +18% |
| Distância ao máximo de 52 semanas | 0,10 | +8% / +16% |
| Rendimento de 3 meses | 0,05 | +9% / +15% |
| Efficiency Ratio de 63 sessões | 0,01 | +12% / +16% |
| Regularidade (R² de 63 sessões) | −0,02 | +15% / +14% |
| Volatilidade de 3 meses | −0,08 | +14% / +10% |

- Os sinais de **tendência longa** (12 meses) são os únicos com algum poder; os sinais só dos últimos 3 meses quase não têm.
- Ser ganhador nas três estratégias nos 12 meses anteriores ajudou em out. 2025 (33% voltaram a sê-lo, contra 25%), mas não em abr. 2026 (19% contra 18%).
- Uma pontuação só de tendência longa falhou em abr. 2026 (−7%), quando os ganhadores do período anterior inverteram.

## Regra adoptada

**Elegíveis** (sinais dos últimos 3 meses de que a tendência se mantém): fecho acima da SMA200, SMA50 acima da SMA200 e rendimento de 3 meses positivo.

**Pontuação (0 a 100):** média ponderada dos percentis, em todo o catálogo, de:

| Sinal | Peso | Sentido |
|---|---|---|
| M2 (momento 12-1 / volatilidade anual) | 2 | maior é melhor |
| Volatilidade dos últimos 3 meses (anualizada) | 1 | menor é melhor |
| Inclinação da SMA200 nos últimos 3 meses | 1 | maior é melhor |

A lista mostra os 30 elegíveis com maior pontuação (opção «Todos os elegíveis» para os restantes) e indica quais foram ganhadores nas três estratégias nos últimos 2 anos.

## Validação da regra

Os 30 primeiros de cada lista, comparados com todo o catálogo:

| Lista feita em | Resultado até | Ganhadores nas 3: top 30 | Catálogo | Rendimento: top 30 | Catálogo |
|---|---|---|---|---|---|
| 23 out. 2025 | 23 out. 2026 | **47%** | 27% | **+26%** | +13% |
| 23 abr. 2026 | 23 out. 2026 | 20% | 18% | +1% | +4% |
| 23 out. 2025 | 23 abr. 2026 | **47%** | 26% | **+20%** | +9% |
| 23 jan. 2026 | 23 jul. 2026 | **57%** | 25% | **+19%** | +9% |
| 23 jan. 2026 | 23 out. 2026 | **27%** | 21% | **+11%** | +6% |

Em média, +16 pontos percentuais de ganhadores nas três estratégias e +6,7 pontos de rendimento. Foi a variante mais consistente das testadas (tendência longa simples; com filtro de tendência intacta; perto do máximo; sem sobre-extensão; regularidade): ganhou ao catálogo em percentagem de ganhadores nas cinco janelas. Em abr. 2026 a vantagem foi pequena e o rendimento ficou abaixo do catálogo.

## Limitações

- Três anos de dados e janelas sobrepostas: a validação é indicativa, não estatisticamente forte.
- Período de subida generalizada; num mercado em queda, a condição de elegibilidade deixa a lista curta ou vazia.
- Viés de sobrevivência: só acções que existem hoje no catálogo.
- A validação foi feita a 24 out. 2026; os valores da tabela são fixos na API até nova validação.

## Integração

- `shared/promessas.js`: `features(quotes)` (sinais na última sessão; precisa de 316 sessões), `eligible(features)`, `rank(items)` (pontuação e posição), `WEIGHTS`, `TOP_N`. Testado em `frontend/test/promessas.test.js`.
- `GET /api/v1/promessas?scope=all|watchlist`: calcula os sinais um instrumento de cada vez (memória), cache de 10 minutos, `pastWinner` a partir dos resultados do BackTest das estratégias disponíveis, e a tabela de validação.
- Página «Promessas» no menu (em telemóvel, pelo botão no WinnersLoosers): explicação, validação por período, lista ordenável e aviso.
