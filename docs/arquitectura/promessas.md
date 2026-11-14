# Promessas — método e validação

> Módulo Promessas (24 out. 2026; pontuação revista a 14 nov. 2026): lista os instrumentos com os sinais que, no passado, antecederam os melhores resultados **das estratégias ligadas** nos 6 meses seguintes, e diz em que momento cada um está (em recuo, perto do máximo ou a meio). Código em `shared/promessas.js` (cálculo) e `GET /api/v1/promessas` (API). Estatística sobre dados passados; não é uma previsão segura nem uma recomendação de investimento.

## Pergunta

A primeira versão perguntava que instrumentos iam **subir** nos 12 meses seguintes. A versão revista pergunta outra coisa, mais útil para quem negoceia: em que instrumentos é que as estratégias ligadas vão ter **oportunidades de negociação com resultado**, isto é, onde é que o resultado líquido das estratégias (com custos estimados) foi maior depois de a lista ser feita.

## Método de investigação (14 nov. 2026)

- Dados: os instrumentos do catálogo com pelo menos 316 sessões em cada data, cotações diárias, fecho ajustado.
- **42 datas mensais**, de jan. 2023 a abr. 2026. Em cada data T, os sinais de cada instrumento foram calculados **só com os dados até T**. 12 675 observações (instrumento × data).
- Resultado medido depois de T: resultado líquido, com custos (`shared/costs.js`), das estratégias ligadas (A-Momentum, C-AI, E-Ondas e F-Mergulho), cada uma a começar sem posição em T, nas 126 sessões seguintes (6 meses), com 15 000 € por compra.
- Medida de cada sinal: correlação de ordem (Spearman) com esse resultado, calculada em cada data e depois a média das 42 datas, com o valor de t dessa média (consistência entre datas).

## O que os dados mostraram

| Sinal | Correlação média | Leitura |
|---|---|---|
| Distância ao mínimo de 52 semanas | 0,19 | tendência longa |
| SMA50 acima da SMA200 (distância) | 0,18 | tendência longa |
| Inclinação da SMA200 em 3 meses | 0,18 | tendência longa |
| M2 (momento 12-1 / volatilidade) | 0,18 | tendência longa |
| Distância à SMA200 | 0,17 | tendência longa |
| Rendimento de 12 meses | 0,17 | tendência longa |
| Parte dos dias a subir (63 sessões) | 0,11 | regularidade da subida |
| Valor negociado médio (50 sessões) | 0,06 | pequeno, mas consistente (t ≈ 6) |
| Volatilidade de 3 meses | ≈ 0 | ajuda a F-Mergulho, prejudica a A-Momentum e a C-AI |

- Os sinais de **tendência longa** continuam a ser os que têm poder; a volatilidade baixa, que pesava na pontuação anterior, não ajuda as estratégias no seu conjunto (as que seguem a tendência ganham mais nos instrumentos que se mexem).
- A **liquidez** tem um efeito pequeno, mas quase sempre do mesmo lado; é também o que torna as ordens executáveis.
- O momento («em recuo» ou «perto do máximo») não melhora a escolha dos instrumentos; serve para saber **que tipo de estratégia** tem entrada próxima, por isso é mostrado e filtrável, mas não entra na pontuação.

## Regra adoptada

**Elegíveis** (inalterado): fecho acima da SMA200, SMA50 acima da SMA200 e rendimento de 3 meses positivo.

**Pontuação (0 a 100):** média ponderada dos percentis, em todo o catálogo, de:

| Sinal | Peso | Sentido |
|---|---|---|
| M2 (momento 12-1 / volatilidade anual) | 1 | maior é melhor |
| Inclinação da SMA200 nos últimos 3 meses | 1 | maior é melhor |
| SMA50 acima da SMA200 (distância) | 1 | maior é melhor |
| Valor negociado médio de 50 sessões | 0,5 | maior é melhor |
| Parte dos dias a subir em 63 sessões | 0,5 | maior é melhor |

Pesos anteriores (`PREVIOUS_WEIGHTS`, até 14 nov. 2026): M2 × 2, volatilidade de 3 meses × 1 (menor é melhor), inclinação da SMA200 × 1.

**Momento** (`setup`, só informativo):

| Momento | Condição | Estratégias com entrada mais próxima |
|---|---|---|
| Em recuo | RSI14 abaixo de 45, ou fecho 5 % ou mais abaixo do máximo de 20 sessões | F-Mergulho, E-Ondas, D-Reversão, J-Bollinger |
| Perto do máximo | fecho a menos de 3 % do máximo de 52 semanas | A-Momentum, C-AI, G-Donchian, I-Máximo52, K-Keltner |
| A meio | os restantes | — |

A lista mostra os 30 elegíveis com maior pontuação (opção «Todos os elegíveis» para os restantes), com a **melhor estratégia ligada** de cada instrumento nos últimos 2 anos (ligação ao Charts) e um botão para o juntar à lista do utilizador.

## Validação da regra

Os 30 primeiros de cada uma das 42 listas, contra todo o catálogo (resultado líquido médio por estratégia e por instrumento, em 6 meses):

| | Catálogo | Pontuação anterior | Pontuação revista |
|---|---|---|---|
| Resultado médio por estratégia | 862 € | 1 566 € | **2 184 €** |
| Com ganho | — | 71 % | 71 % |
| Com ganho em pelo menos 3 das 4 estratégias | — | — | 59 % |
| Comprar e manter, 6 meses | +9,2 % | — | +15,8 % |
| Datas em que ganhou ao catálogo | — | 37 de 42 | 37 de 42 |

A vantagem aparece nas duas metades do período (1 742 € na primeira, 2 625 € na segunda), não vem só dos últimos meses.

### Teste a dois anos (lista de 13 nov. 2024)

A lista calculada só com os dados até 13 nov. 2024 (320 instrumentos, 114 elegíveis), seguida até 13 nov. 2026:

| Os 10 primeiros | 6 meses | 1 ano | 2 anos |
|---|---|---|---|
| **Pontuação anterior** (a que estava em uso): subiram | 9 de 10 | 10 de 10 | 10 de 10 |
| Rendimento médio (catálogo) | +22,6 % (+18,0 %) | +41,3 % (+32,5 %) | +74,9 % (+53,3 %) |
| Ganharam à mediana do catálogo | 8 de 10 | 7 de 10 | 8 de 10 |
| Com ganho nas 4 estratégias (catálogo) | 6 de 10 (19 %) | 6 de 10 (23 %) | 5 de 10 (29 %) |
| **Pontuação revista**: subiram | 8 de 10 | 10 de 10 | 10 de 10 |
| Rendimento médio | +24,9 % | +55,2 % | +95,3 % |
| Ganharam à mediana do catálogo | 7 de 10 | 7 de 10 | 8 de 10 |
| Resultado médio das 4 estratégias (catálogo) | 17,9 k€ (6,3 k€) | 39,5 k€ (12,9 k€) | 65,3 k€ (22,2 k€) |

No catálogo inteiro subiram 78 %, 77 % e 78 % dos instrumentos: «subir» era o resultado normal neste período, por isso a medida que distingue a lista é ganhar à mediana (7 a 8 em 10, contra 5 em 10 ao acaso). A data de 13 nov. 2024 está dentro das 42 datas usadas para rever a pontuação: para a pontuação revista este teste não é independente; para a anterior, validada só com listas de out. 2025 em diante, é.

A API mostra ainda uma tabela de validação por janelas (listas de há 12, 9 e 6 meses), recalculada todas as semanas com a pontuação em vigor (`scripts/analysis-revalidation.mjs`, tabela `analysis_results`).

## Limitações

- Menos de quatro anos de listas e janelas de 6 meses sobrepostas: a validação é indicativa, não estatisticamente forte.
- Período de subida generalizada; num mercado em queda, a condição de elegibilidade deixa a lista curta ou vazia, e não há dados para saber como se comporta.
- Viés de sobrevivência: só acções que existem hoje no catálogo.
- A pontuação foi revista com as estratégias A, C, E e F ligadas; se o conjunto de estratégias ligadas mudar muito, a revisão deve ser repetida.

## Integração

- `shared/promessas.js`: `features(quotes)` (sinais na última sessão; precisa de 316 sessões), `eligible(features)`, `setup(features)`, `rank(items, weights)` (pontuação e posição), `WEIGHTS`, `PREVIOUS_WEIGHTS`, `TOP_N`. Testado em `frontend/test/promessas.test.js`.
- `GET /api/v1/promessas?scope=all|watchlist`: calcula os sinais um instrumento de cada vez (memória), cache de 10 minutos; junta a cada instrumento `setup`, `best` (melhor estratégia ligada nos últimos 2 anos, se teve ganho), `inWatchlist`, `pastWinner` e a tabela de validação.
- Página «Promessas» no menu (em telemóvel, pelo botão no WinnersLoosers): explicação, validação por período, filtro «Momento», lista ordenável com a melhor estratégia e o botão da lista, e aviso.
