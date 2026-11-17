# Fases de Wyckoff — regra e estudo

> Etiqueta «Fase» (16 nov. 2026): em que fase do ciclo de Wyckoff está cada instrumento — acumulação, subida, distribuição, queda ou indefinida. Código em `shared/wyckoff.js` (regra), `GET /api/v1/wyckoff` (API) e `frontend/src/lib/wyckoff.js` + `PhaseBadge` (interface). Aparece no Acompanhar (coluna ordenável), no Charts (ao lado do símbolo), nas Promessas (coluna e filtro) e no HeatMap (filtro). É descritiva: não é uma previsão, não entra em nenhuma estratégia e a Automação não a usa.

## A teoria

Quatro fases: **acumulação** (depois de uma queda prolongada, os preços andam de lado numa faixa estreita enquanto os grandes investidores compram), **subida** (o preço rompe a resistência dessa faixa), **distribuição** (no topo, depois de uma forte valorização, o preço volta a andar de lado enquanto os grandes investidores vendem) e **queda** (o preço quebra o suporte dessa faixa).

## Regra

A teoria é qualitativa; aqui cada fase é uma regra sobre as cotações diárias (fecho ajustado) e o volume, só com dados até à sessão em causa. Só contam sessões fechadas.

| Conceito | Regra |
|---|---|
| Faixa lateral | Nas últimas 40 sessões, a distância entre o fecho mais alto e o mais baixo é pequena para o que é normal neste instrumento: menos de 1,3 vezes a volatilidade diária de um ano × √40 (um passeio aleatório daria cerca de 1,6) |
| **Acumulação** | Faixa lateral no terço inferior do intervalo de 52 semanas, com o topo da faixa pelo menos 20 % abaixo do máximo de 52 semanas |
| **Distribuição** | Faixa lateral no terço superior do intervalo de 52 semanas, com o fundo da faixa pelo menos 25 % acima do mínimo de 52 semanas |
| **Subida** | Fora de uma faixa lateral: fecho acima da SMA50, SMA50 maior do que há 20 sessões e rendimento de 63 sessões positivo |
| **Queda** | Fora de uma faixa lateral: fecho abaixo da SMA50, SMA50 menor do que há 20 sessões e rendimento de 63 sessões negativo |
| **Indefinida** | O resto: faixas laterais a meio do intervalo, viragens |

Com cada fase vêm o **suporte** e a **resistência** (fecho mais baixo e mais alto da janela, a preços de hoje), há quantas sessões o fecho anda dentro da faixa e de que lado esteve o volume (`volumeBias`, de −1 a 1: dias de subida menos dias de queda, em parte do volume). São precisas 253 sessões de histórico.

## Estudo (16 nov. 2026)

**Método.** 322 instrumentos, 40 datas mensais (primeira sessão de cada mês, de fev. 2023 a mai. 2026), 12 697 observações. Em cada data a fase foi calculada só com os dados até essa data; depois mediu-se, nos 6 meses seguintes (126 sessões): o rendimento do preço e o resultado líquido, com custos, das doze estratégias ligadas (cada uma a começar sem posição, 15 000 € por compra). «Datas» é em quantas datas a média do grupo ficou acima da média do catálogo.

| Fase | Parte das observações | Rendimento em 6 meses | Estavam mais altas | Datas acima do catálogo | Estratégias: € por estratégia | Datas acima do catálogo |
|---|---|---|---|---|---|---|
| Acumulação | 6 % | **+1,9 %** | 51 % | 7 de 39 | **−27 €** | 8 de 39 |
| Subida | 23 % | +9,9 % | 67 % | 30 de 40 | 738 € | 31 de 40 |
| Distribuição | 22 % | **+11,4 %** | 70 % | 32 de 39 | **850 €** | 32 de 39 |
| Queda | 13 % | +7,4 % | 61 % | 10 de 38 | 257 € | 8 de 38 |
| Indefinida | 37 % | +7,0 % | 62 % | 7 de 40 | 281 € | 7 de 40 |
| Catálogo | 100 % | +8,4 % | 64 % | — | 490 € | — |

**O que os dados mostram**

1. **As fases separam os resultados, mas ao contrário da leitura habitual da teoria.** Neste período, as acções em «distribuição» continuaram a subir mais do que as outras e foi nelas que as estratégias mais ganharam; as em «acumulação» foram as mais fracas nas duas medidas. O mesmo aconteceu nas duas metades do período.
2. **O que conta é o sítio da faixa, não a faixa.** Uma faixa lateral no terço superior do intervalo de 52 semanas rendeu +10,2 % em 6 meses; no terço inferior, +3,1 %; a meio, +6,8 %. É o efeito de momentum que as Promessas e o Portfolio Recomendado já usam: o que está forte tende a continuar forte.
3. **A saída da faixa acrescenta pouco.** Em 6 821 saídas de uma faixa lateral, as saídas para cima renderam +8,6 % em 6 meses e as saídas para baixo +8,0 %. Uma faixa no topo que quebra **para baixo** ainda rendeu +10,3 %; uma faixa em baixo que rompe **para cima** só +5,5 %.
4. **O volume quase não ajuda.** Dentro da faixa, o lado do volume não muda o resultado (distribuição com volume «de venda»: +12,0 %; «de compra»: +10,6 %). Na saída para cima, o volume acima de 1,5 vezes a média dá +10,1 % contra +8,1 % sem ele: é o único efeito do lado que a teoria prevê, e é pequeno.
5. **Por tipo de estratégia:** as de tendência (A, B, C, G, H, I, K, L) perdem em acumulação (−146 € por estratégia) e ganham em subida e distribuição (747 € e 832 €); as de recuo (D, E, F, J) ganham em todas as fases, menos em acumulação (211 €) do que em distribuição (886 €).

**Sensibilidade.** O resultado não depende dos parâmetros: com janela de 30 ou 60 sessões, aperto de 1,0 ou 1,6, queda mínima de 15 % ou 30 % e subida mínima de 20 % ou 35 %, a acumulação fica sempre entre +1,6 % e +2,7 % em 6 meses e a distribuição entre +10,8 % e +12,3 %.

## Como ler a etiqueta

- **Subida** e **Distribuição**: foi onde as estratégias ligadas mais ganharam. «Distribuição» quer dizer «faixa no topo depois de uma subida»; pela teoria é um aviso, nos nossos dados foi quase sempre uma pausa (a teoria também lhe chama reacumulação, e só a saída da faixa as distingue).
- **Acumulação**: pela teoria é a oportunidade; nos nossos dados foi onde menos convinha estar. Não é um sinal de compra.
- **Queda** e **Indefinida**: abaixo do catálogo, sem serem muito diferentes dele.

A explicação de cada etiqueta (`title`) traz estes números.

## Limitações

- **Só mercado a subir.** De 2023 a 2026 o catálogo subiu 8,4 % por semestre, em média. Não há um ciclo completo no histórico: a teoria descreve topos e fundos de mercado, e este período quase não os teve. Num mercado em queda, as faixas no topo podem bem ser distribuições verdadeiras.
- **Volume diário.** A leitura tradicional de Wyckoff usa o volume ao longo do dia; aqui só há o volume da sessão.
- **Viés de sobrevivência:** o catálogo é o de hoje.
- **Observações sobrepostas:** datas mensais com janelas de 6 meses; os resultados são indicativos.
- Os números das explicações são os deste estudo; devem ser revistos quando houver mais histórico (em especial depois de uma queda de mercado).

## O que ficou por fazer

O estudo não justifica uma estratégia que compre a saída da acumulação nem um aviso de venda por distribuição: neste período, ambos teriam sido contraproducentes. O que os dados sugerem, e fica como ideia no Laboratório, é usar a fase como **filtro**: evitar entradas em acumulação e em queda. Antes disso é preciso medir se o filtro acrescenta alguma coisa às condições de tendência que as estratégias já têm.

## Integração

- `shared/wyckoff.js`: `prepareSeries`, `phaseAt(series, i, opções)`, `phase(quotes)`, `PHASES`, `DEFAULT_OPTIONS`, `sessionsNeeded`. Testado em `frontend/test/wyckoff.test.js`.
- `GET /api/v1/wyckoff`: fase de cada instrumento activo na última sessão fechada, `counts` por fase; igual para todos os utilizadores; cache de 10 minutos (responde com o que tem e recalcula em segundo plano), recalculado no arranque e depois de cada recolha.
- Interface: `useWyckoff()` (`lib/queries.js`), `PhaseBadge` (`components/finance/`), textos e ordem em `lib/wyckoff.js`.
