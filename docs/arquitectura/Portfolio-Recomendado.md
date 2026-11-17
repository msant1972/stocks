# Portfolio Recomendado — regra e validação

> Módulo «Portfolio Recomendado» (14 nov. 2026): uma carteira-modelo de 20 instrumentos, revista de duas em duas semanas, com a lista do que comprar, manter e vender em cada revisão e o rendimento dos últimos 24 meses. Código em `shared/strategies/portfolio.js` (motor), `api/src/services/recommendedPortfolio.js` e `GET /api/v1/recommended-portfolio` (API) e `frontend/src/features/portfolio/` (página). Regra fixa aplicada a dados passados; não é aconselhamento de investimento e não envia ordens.

## O que o módulo responde

«Se eu quisesse ter 20 acções do catálogo, quais, e o que mudo de duas em duas semanas?» As outras estratégias decidem instrumento a instrumento; esta, como a [Rotação](Rotacao.md), compara os instrumentos entre si e trata do capital finito: há 20 lugares, escolhidos pelo mérito relativo.

## Regra

**Quando.** A revisão faz-se na primeira sessão de cada bloco de duas semanas (os blocos contam-se a partir de uma segunda-feira fixa, 29 dez. 1969, para as datas não dependerem da janela nem do dia em que se consulta). A decisão usa o fecho dessa sessão; as ordens são para a abertura da sessão seguinte. Só contam sessões fechadas: as cotações provisórias da sessão em curso ficam de fora, para as listas não mudarem a meio do dia.

**Ranking.** A pontuação é a das [Promessas](promessas.md), calculada só com os dados até à data da revisão: percentis, em todo o catálogo, do M2 (momentum 12-1 sobre a volatilidade), da inclinação da SMA200 em 3 meses e da distância da SMA50 à SMA200 (peso 1 cada), do valor negociado médio de 50 sessões e da parte dos dias a subir em 63 sessões (peso ½ cada).

**Elegíveis.** Tendência intacta (fecho acima da SMA200, SMA50 acima da SMA200, rendimento de 3 meses positivo), valor negociado médio de pelo menos 1 M€ por sessão, 316 sessões de histórico e cotação nas últimas 5 sessões.

**Decisão** (`plan`):

1. **Manter:** as posições elegíveis que estão entre os 40 melhores (`keepRank`, o dobro das posições: poupa trocas e custos).
2. **Comprar:** os lugares livres vão, pela ordem do ranking, para os melhores que caibam no limite de **5 por sector** (`maxPerSector`, 25 % da carteira): primeiro os que estão entre os 40 melhores; depois as posições actuais que já saíram desse grupo (ficam, em vez de serem trocadas por outras que também estão fora dele); só no fim instrumentos novos de fora do grupo.
3. **Vender:** as restantes. Motivo «perdeu a tendência» (já não é elegível) ou «saiu dos melhores» (há um substituto melhor que cabe no limite por sector).

Uma posição que saiu dos 40 melhores só é vendida quando há substituto, e nunca se vende e volta a comprar o mesmo instrumento na mesma revisão. Não há stops entre revisões.

**Pesos.** O dinheiro disponível é repartido em partes iguais pelos lugares vazios (5 % cada, no início). As posições mantidas não são reequilibradas: as que sobem ficam com mais peso. Sem elegíveis suficientes, o resto fica em numerário.

## Indicador de rendimento

- A simulação corre desde o início do histórico (5 anos), para a janela medir uma carteira já em andamento; o indicador é o valor da carteira nos **últimos 24 meses**, em base 100 no início da janela.
- Preços ajustados (dividendos incluídos). Custos estimados da SAXO (`shared/costs.js`): comissão e meio spread em cada ordem, custódia ao dia sobre o valor das posições. Capital de referência de 300 000 € (20 × 15 000 €), que só conta para o mínimo da comissão.
- Comparação (`benchmark`): todo o catálogo em partes iguais, comprado no início da janela e mantido, com os mesmos custos.
- A página mostra também os últimos 12, 6 e 3 meses, a maior queda desde um máximo, as posições fechadas e a parte com ganho, e os custos pagos.

## Resultados (14 nov. 2026, catálogo de 328 instrumentos)

| | Portfolio | Catálogo em partes iguais |
|---|---|---|
| Últimos 24 meses (13 nov. 2024 a 13 nov. 2026) | **+80,0 %** | +52,5 % |
| Últimos 12 meses | +19,0 % | +15,0 % |
| Últimos 6 meses | **−7,8 %** | +4,7 % |
| Últimos 3 meses | −3,0 % | −2,3 % |
| Maior queda desde um máximo | −16,9 % | −14,7 % |
| Período anterior (6 mar. 2023 a 13 nov. 2024, carteira a começar vazia) | +21,1 % | +14,6 % |

52 revisões em 24 meses, 2,6 trocas por revisão em média, 134 posições fechadas (53 % com ganho), custos de 2,9 % do valor inicial.

A carteira ganhou ao catálogo nos dois períodos, mas **perdeu 12 pontos nos últimos 6 meses**: as acções que vinham a subir mais inverteram, e uma carteira de tendência concentra-se nelas. É o risco conhecido deste tipo de regra, e a queda máxima é maior do que a do catálogo.

### Sensibilidade

Os parâmetros foram fixados antes de olhar para os resultados (20 posições e duas semanas são requisitos; 40 é o dobro das posições, como na Rotação; 5 por sector é um quarto da carteira). As variantes servem para ver quanto do resultado depende de cada escolha (24 meses / período anterior; catálogo +52,5 % / +14,6 %):

| Variante | 24 meses | Período anterior |
|---|---|---|
| **Regra adoptada** | +80,0 % | +21,1 % |
| Pontuação: só M2 | +76,1 % | +25,8 % |
| Pontuação: rendimento de 12 meses | +82,0 % | +26,0 % |
| Pontuação: momentum 12-1 (a da Rotação) | +71,6 % | +24,5 % |
| Pontuação anterior das Promessas (com volatilidade baixa) | +58,3 % | +19,1 % |
| Sem limite por sector | +56,8 % | +31,8 % |
| 4 por sector / 6 por sector | +71,5 % / +67,7 % | +13,4 % / +26,7 % |
| Manter até ao lugar 20 / 30 / 60 | +79,9 % / +81,8 % / +72,4 % | +17,3 % / +22,7 % / +23,9 % |
| Revisão semanal / de 4 em 4 semanas | +80,6 % / +74,0 % | +20,8 % / +30,9 % |
| 10 posições / 30 posições | +46,7 % / +70,9 % | +30,9 % / +7,3 % |

Quase todas as variantes ganham ao catálogo nos dois períodos, mas com diferenças grandes entre si (de +47 % a +82 % em 24 meses): a vantagem de seguir a tendência parece real neste período; o tamanho exacto dela é ruído. O limite por sector reduziu a queda máxima (−16,9 % contra −21,6 % sem limite).

A data em que a simulação começa não muda a carteira de hoje: com seis datas de início diferentes (de fev. 2023 a nov. 2024), as 20 posições actuais são as mesmas.

## Revalidação com sete anos (17 nov. 2026)

Com o histórico alargado a sete anos, a carteira tem revisões desde mar. 2021 e passa pelo mercado em queda de 2022. Rendimento por ano civil, com custos (a carteira simulada desde o início do histórico; o catálogo comprado no início de cada janela):

| Ano | Portfolio | Catálogo | Diferença | Maior queda: Portfolio / catálogo |
|---|---|---|---|---|
| 2021 (desde mar.) | +19,6 % | +18,2 % | +1,4 | −13,9 % / −5,8 % |
| **2022 (queda)** | **−24,5 %** | −8,8 % | **−15,6** | **−30,2 %** / −21,4 % |
| 2023 | +9,6 % | +17,4 % | −7,8 | −8,4 % / −9,9 % |
| 2024 | +27,4 % | +11,3 % | +16,1 | −12,1 % / −9,0 % |
| 2025 | +43,2 % | +29,4 % | +13,9 | −15,6 % / −14,6 % |
| 2026 (até 13 nov.) | +16,0 % | +12,2 % | +3,9 | −16,7 % / −9,5 % |
| **Mar. 2021 a nov. 2026** | **+119,0 %** | **+129,9 %** | **−10,9** | −31,2 % / −21,5 % |

**Leitura:** em todo o período, a carteira **ficou abaixo do catálogo em partes iguais**. Os +80 % contra +50 % dos últimos 24 meses são reais, mas dependem do período: em 2022 a carteira perdeu quase três vezes mais do que o catálogo, e em 2023 não recuperou ao mesmo ritmo. Como nas Promessas, a regra segue a tendência e o momentum: ganha nos anos de subida e falha quando o mercado vira. O número de elegíveis nunca desceu abaixo de 26 (jul. 2022), por isso a carteira ficou sempre investida.

Variantes no mesmo período: com a pontuação anterior das Promessas, −10,8 % em 2022 e +103,2 % no total (pior no total, melhor na queda); sem limite por sector, −23,9 % em 2022 e +114,5 % no total.

**O que fica por testar:** um filtro de mercado — por exemplo, deixar parte da carteira em numerário quando menos de metade do catálogo está acima da SMA200 (como o filtro de regime da Rotação). A medida é a mesma desta tabela: tem de reduzir a perda de 2022 sem tirar mais do que isso nos anos de subida.

## Data de início (17 nov. 2026)

Na página, o utilizador pode escolher a **data de início** da carteira: começa vazia nesse dia, faz logo aí a primeira revisão (ao fecho, com as compras na abertura seguinte, sem esperar pelo bloco de duas semanas) e segue as revisões normais até hoje; o rendimento é medido desde essa data, contra o catálogo comprado no mesmo dia. A data fica gravada por utilizador (tabela `portfolio_start_dates`) até ser alterada. A primeira data possível (`minStart`) é a sessão em que 20 instrumentos já têm as 316 sessões que a pontuação precisa (fev. 2021 com os sete anos de histórico). As carteiras de datas diferentes podem ter instrumentos diferentes: a escolha de cada revisão depende do que a carteira já tem (manutenção até ao lugar 40 e limite por sector).

## Limitações

- **Falha num mercado em queda.** Com sete anos de dados (ver acima), perdeu 24,5 % em 2022 contra 8,8 % do catálogo e ficou sempre investida (nunca menos de 26 elegíveis).
- **A pontuação das Promessas foi revista com datas deste mesmo período** (jan. 2023 a abr. 2026): o resultado não é um teste independente da pontuação. As variantes com sinais da literatura (momentum 12-1, rendimento de 12 meses) dão resultados parecidos.
- **Viés de sobrevivência:** o catálogo é o de hoje; favorece a carteira e a comparação.
- **Sem stops:** entre revisões não há saídas, e uma posição pode cair muito antes de perder a tendência (exemplo: TKA.DE, −22 % em dois meses).
- **Sector:** usa-se o sector actual de cada empresa para todo o passado.
- **Execução:** assume a abertura da sessão seguinte, sem impacto no preço; os custos são uma estimativa.
- Os fundamentais (cartão «Valor e qualidade» da Rotação) não entram: só existe o valor actual, e usá-lo no passado seria olhar para o futuro.

## Integração

- `shared/strategies/portfolio.js`: `prepareInstrument`, `featuresAt` (os mesmos sinais de `promessas.features`), `ranking`, `plan`, `simulate`, `blockOf`/`nextBlockStart` (calendário das revisões), `DEFAULT_OPTIONS`. Testado em `frontend/test/portfolio.test.js`.
- `GET /api/v1/recommended-portfolio`: igual para todos os utilizadores (só `inWatchlist` é de cada um); lê as cotações um instrumento de cada vez, guarda o resultado em cache (responde com o que tem e recalcula em segundo plano ao fim de 10 minutos) e é recalculado no arranque e depois de cada recolha. Devolve `summary`, `curve` (uma leitura por semana), `review` (última revisão: `buy`, `keep`, `sell`, `executed`, `next`), `positions`, `reviews` (as 12 últimas) e `trades` (as 100 últimas).
- Página «Portfolio Recomendado» (grupo Estratégias): rendimento e gráfico contra o catálogo, as três listas, a carteira por sector, as revisões anteriores e as posições fechadas; botão para juntar cada instrumento à lista do utilizador. A Automação não usa esta carteira.
