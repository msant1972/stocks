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

## Revalidação com sete anos (17 nov. 2026)

Com o histórico alargado a sete anos (nov. 2019 a nov. 2026), a regra das 52 semanas passa a ter **66 datas mensais** (dez. 2020 a mai. 2026, 20 858 observações) e inclui **o mercado em queda de 2022**. Resultado líquido médio das doze estratégias nos 6 meses seguintes, por fase e por período (entre parênteses, o catálogo nas mesmas datas):

| Fase | 2021 (subida) | **2022 (queda)** | 2023–2026 (subida) | Todo o período |
|---|---|---|---|---|
| Acumulação | 426 € (678 €) | **479 € (427 €)** | −40 € (480 €) | 146 € (478 €) |
| Subida | 247 € (322 €) | −438 € (−283 €) | 734 € (463 €) | 486 € (335 €) |
| Distribuição | 415 € (351 €) | **−978 € (−349 €)** | 838 € (464 €) | 602 € (387 €) |
| Queda | −298 € (−261 €) | 48 € (−71 €) | 254 € (564 €) | 139 € (275 €) |
| Indefinida | 246 € (231 €) | 28 € (−14 €) | 282 € (490 €) | 226 € (350 €) |

No rendimento do preço em 6 meses, a diferença para o catálogo em 2022 foi: distribuição −6,2 pontos (acima do catálogo só em 3 de 11 datas), acumulação +2,4 pontos (7 de 12 datas).

**O que muda na leitura:** as fases **dependem do mercado**. Em 2022, a distribuição foi o pior grupo e a acumulação ficou acima do catálogo — o que a teoria diz. Nos anos de subida foi o contrário. A etiqueta descreve bem a situação do instrumento, mas o que ela anuncia depende de o mercado, no seu conjunto, estar a subir ou a cair. Com um único ano de queda, isto é uma indicação, não uma prova.

**Variante de 3 anos** (intervalo, queda e subida medidos em 3 anos em vez de 52 semanas; testada com os mesmos limiares e com queda de 35 % e subida de 50 %): só há fase a partir de nov. 2022, o que deixa 2 datas de 2022 e 41 de subida. Nas datas comuns dá praticamente o mesmo que a regra das 52 semanas (acumulação −4,0 e −3,8 pontos face ao catálogo, distribuição +2,3 e +3,2). **Não acrescenta nada**; a regra mantém-se nas 52 semanas, e a leitura de 273 sessões por instrumento chega.

## Eventos das fases C e D (17 nov. 2026)

**Pergunta.** O esquema completo do método distingue, dentro de cada faixa, os eventos que a resolvem: na fase C o *Spring* (falsa quebra do suporte que volta à faixa) e o *UTAD* (o mesmo, acima da resistência); na fase D o *SOS* e o *SOW* (saída da faixa com força e volume) e o *LPS* e o *LPSY* (o último recuo que respeita o nível rompido). É por eles que uma faixa no topo se revela distribuição ou reacumulação. Detectados em cotações diárias, prevêem o que acontece a seguir?

**Definições** (sobre a faixa lateral das 40 sessões anteriores, a da regra das fases; preços ajustados):

| Evento | Regra |
|---|---|
| Spring | o mínimo do dia fica pelo menos 1 % abaixo do suporte e, até 3 sessões depois, um fecho volta para dentro da faixa |
| UTAD | o máximo fica pelo menos 1 % acima da resistência e, até 3 sessões depois, um fecho volta para dentro |
| SOS | fecho acima da resistência, com volume de pelo menos 1,5 vezes a média de 50 sessões e no terço de cima do dia |
| SOW | fecho abaixo do suporte, com o mesmo volume e no terço de baixo do dia |
| LPS | até 25 sessões depois de um SOS, um recuo com volume abaixo da média até 3 % da antiga resistência, sem fechar abaixo dela |
| LPSY | o espelho, depois de um SOW |

Variante exigente: só faixas com 60 sessões ou mais, quebras de 2 %, regresso em 2 sessões e volume de 2 vezes a média.

**Resultado** (16 799 eventos de nov. 2020 a mai. 2026; 2 531 na variante exigente). Rendimento nos 6 meses seguintes, diferença para a média do catálogo nas mesmas datas:

| Evento | Todos | Faixa no topo | Faixa no fundo |
|---|---|---|---|
| Spring | −0,2 | +2,3 | −3,1 |
| UTAD | +0,4 | +2,7 | −4,0 |
| SOS | +0,9 | +3,6 | −5,1 |
| SOW | −0,2 | +2,8 | −3,5 |
| LPS | +0,7 | +3,7 | −7,0 |
| LPSY | +0,1 | +2,8 | −1,7 |

- **Eventos opostos dão o mesmo resultado.** Numa faixa no topo, um Spring (sinal de reacumulação) e um UTAD (sinal de distribuição) foram seguidos de +2,3 e +2,7 pontos; um SOS e um SOW, de +3,6 e +2,8. Nos dados diários, os eventos **não resolvem** a faixa.
- **O que conta é o sítio da faixa e o mercado:** qualquer evento numa faixa no topo ficou acima do catálogo nos anos de subida e abaixo em 2022; numa faixa no fundo, o contrário. É o mesmo padrão das fases.
- **O volume quase não muda nada** (UTAD com volume +1,5 pontos, sem volume 0,0; Spring +0,9 e −0,7).
- A variante exigente dá a mesma conclusão.

**Decisão:** não se implementam os eventos, as subfases A a E nem a resolução automática da faixa (passo 3 do plano). Os eventos, como os detectamos, não acrescentam informação às fases e ao mercado. Limitações: só cotações diárias (o método lê-se muitas vezes em gráficos intradiários e com mais atenção ao volume de cada barra), definições mecânicas de conceitos que no método são de leitura, e um só ano de queda.

## Como ler a etiqueta

Desde 17 nov. 2026, as faixas chamam-se **«Faixa no topo»** e **«Faixa no fundo»** (antes «Distribuição» e «Acumulação»; os identificadores na API continuam `distribution` e `accumulation`). Pela teoria, uma faixa no topo pode ser distribuição ou reacumulação, e uma faixa no fundo acumulação ou redistribuição; só a saída da faixa diz qual, e a regra não a detecta (nem os eventos acima ajudam).

- **Subida** e **Faixa no topo**: nos anos de subida, foi onde as estratégias ligadas mais ganharam (a faixa no topo foi quase sempre reacumulação); em 2022 a faixa no topo foi o pior grupo (distribuição).
- **Faixa no fundo**: nos anos de subida, foi onde menos convinha estar; em 2022 ficou acima do catálogo. Não é um sinal de compra.
- **Queda** e **Indefinida**: abaixo do catálogo, sem serem muito diferentes dele.

A explicação de cada etiqueta (`title`) traz estes números.

## Limitações

- **Um só ano de queda.** Com os sete anos, há 2022 (ver a revalidação acima), mas é um único mercado em queda: chega para ver que as fases mudam de sentido com o mercado, não para medir quanto.
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
