# Rotação por momentum relativo

> Implementada a 14 nov. 2026 em `shared/strategies/rotacao.js` (motor), `api/src/services/rotation.js` e `api/src/routes/rotation.js`
> (rota `GET /strategies/rotation`) e na página **Rotação** (grupo Estratégias). Testes em `frontend/test/rotacao.test.js` e
> `api/test/rotation.test.js`. Descrição metodológica para estudo e simulação; não constitui recomendação de investimento.

## 1. Ideia

As outras estratégias do registo (A a F) decidem **instrumento a instrumento**: cada instrumento é simulado isoladamente, com o seu
próprio capital. A rotação por momentum relativo (Jegadeesh e Titman, 1993) compara os instrumentos **entre si**: no fim de cada mês
ordena o universo pelo retorno dos últimos 12 meses (sem o último) e mantém só os melhores. É a anomalia de momentum transversal, a
mais documentada da literatura, e resolve o problema do capital finito: a carteira tem N posições escolhidas pelo mérito relativo,
em vez de comprar todos os sinais.

É uma estratégia de **carteira**, por isso não cabe no registo de estratégias por instrumento (`run(quotes)`): tem o seu motor,
rota e página. Não envia ordens e a Automação não a usa; a página mostra a revisão seguinte como indicação para decisão manual.

## 2. Regras

Tudo sobre o fecho ajustado; sem *lookahead*.

- **Revisão:** no último dia útil de cada mês, ao fecho. As ordens executam-se na **abertura da sessão seguinte**, a preços reais.
- **Momentum 12-1:** `adj[t−21] / adj[t−252] − 1`.
- **Elegível:** momentum 12-1 positivo (momentum absoluto), fecho acima da SMA200 (tendência) e valor negociado médio de 50 sessões de
  pelo menos 5 M€ (liquidez). Instrumentos sem cotação há mais de 5 sessões ficam de fora.
- **Carteira:** N posições (5, 10 ou 20; por omissão 10) com um lote de 15 000 € cada, quantidades inteiras.
  - mantém uma posição enquanto for elegível e estiver entre os `2 × N` melhores (histerese: poupa rotação e custos);
  - vende as que deixam de cumprir; compra, pela ordem do ranking, até ter N posições.
- Sem stops entre revisões nem reforços. Custos estimados como nas outras estratégias (`shared/costs.js`); a posição aberta no fim
  conta como vendida ao último preço.

## 3. Parâmetros (`DEFAULT_OPTIONS`)

| Parâmetro | Valor | O que controla |
|---|---|---|
| `budget` | 15 000 € | lote por posição |
| `positions` | 10 | posições em simultâneo |
| `keepRank` | 20 (2 × N na rota) | lugar a partir do qual uma posição sai por ranking |
| `lookback`, `skip` | 252, 21 | janela do momentum (12 meses sem o último) |
| `smaTrend` | 200 | média de tendência |
| `minTradedValue`, `tradedWindow` | 5 M€, 50 | liquidez mínima |
| `staleSessions` | 5 | sessões sem cotação até um instrumento sair do ranking |

## 4. Evidência (simulação de 14 nov. 2026, catálogo de 329 instrumentos)

Resultado depois de custos, sobre o capital máximo investido (150 000 € com 10 posições), nos últimos 2 anos / período de verificação
(2022–2024), contra comprar e manter todo o catálogo em partes iguais:

| Variante | Resultado | Pior queda do resultado | Operações | Comprar e manter |
|---|---|---|---|---|
| **Base (N = 10, manter 20)** | **52,6 % / 34,4 %** | −35 % / −17 % | 43 / 55 | 40,6 % / 20,2 % |
| N = 5 | 64,0 % / 49,1 % | −37 % / −19 % | 24 / 28 | idem |
| N = 20 | 66,1 % / 31,0 % | −28 % / −15 % | 64 / 89 | idem |
| N = 30 | 71,5 % / 36,4 % | −29 % / −15 % | 77 / 103 | idem |
| N = 10, sem histerese | 46,6 % / 29,8 % | −37 % / −18 % | 72 / 91 | idem |
| N = 10, manter 30 | 66,0 % / 25,2 % | −34 % / −15 % | 33 / 48 | idem |
| Momentum de 6 meses | 56,5 % / 13,7 % | −35 % / −26 % | 65 / 85 | idem |
| Momentum de 9 meses | 65,9 % / 39,8 % | −38 % / −17 % | 49 / 66 | idem |
| Sem filtro da SMA200 | 87,8 % / 57,8 % | −27 % / −17 % | 41 / 50 | idem |

Bate comprar e manter o catálogo em todas as variantes e nos dois períodos, e com poucas operações (os custos são cerca de 2 % do
capital). Os números **não são comparáveis em euros** com as estratégias por instrumento: aqui o capital é fixo (150 000 €); nas
outras o «capital máximo» é a soma dos máximos de cada instrumento (mais de 10 milhões de euros na A-Momentum).

Escolhi os parâmetros clássicos da literatura (12-1, 10 posições, histerese de 2 × N) e **não os afinei** pelos resultados. A variante
sem filtro da SMA200 dá mais, mas o filtro serve para os mercados em queda, que os dois períodos de teste não têm.

## 4b. Opções da página (14 nov. 2026)

Desligadas por omissão (base: 12 meses, lotes iguais, sem filtro). Resultados sobre o catálogo, 10 posições, últimos 2 anos / verificação
(base 52,6 % / 34,4 %):

| Opção | Resultado | Pior queda | Capital máximo |
|---|---|---|---|
| Janela de 6 meses | 56,5 % / 13,7 % | −35 % / −26 % | 150 k€ |
| Janela de 9 meses | 65,9 % / 39,8 % | −38 % / −17 % | 150 k€ |
| Filtro de mercado: sem compras novas | 45,9 % / 28,5 % | −33 % / −17 % | 150 k€ |
| Filtro de mercado: também vende tudo | 26,3 % / 20,9 % | −34 % / −17 % | 150 k€ |
| Dimensionamento pela volatilidade | 41,9 % / 31,6 % | −26 % / −14 % | 113 k€ / 124 k€ |

- **Filtro de regime (dual momentum):** com menos de metade dos instrumentos acima da SMA200 na data da revisão, não se compra (modo 1) ou também se vende
  tudo e fica-se em numerário (modo 2). Só 2 de 24 revisões ficam em baixa nestes períodos, por isso o filtro só custa resultado e não se pode provar o
  benefício sem uma queda prolongada nos dados.
- **Dimensionamento pela volatilidade:** o lote de cada compra é o orçamento × (volatilidade mediana dos elegíveis / volatilidade do instrumento), entre ½ e 2
  lotes. Reduz a pior queda e o capital investido; o retorno por unidade de queda sobe (1,6 / 2,3 contra 1,5 / 2,0).
- **Janela:** 9 meses dá mais que 12 nos dois períodos, mas 6 meses dá menos na verificação (a diferença é ruído); fica 12, o valor da literatura.
- **Valor e qualidade:** cartão informativo com as 30 melhores empresas por fundamentais, sem simulação (ver Novas-estrategias.md, secção 4).

## 5. Limitações e riscos

- **Mercado em alta:** os dois períodos são de mercado em alta; o momentum tem quedas fortes nas viragens (o «crash» do momentum) que
  não estão testadas.
- **Viés de sobrevivência:** o catálogo é o de hoje; as empresas que saíram da bolsa não entram, o que favorece o resultado.
- **Concentração:** 10 posições são poucas: a pior queda do resultado foi de 35 % (últimos 2 anos). Com 20 posições a queda é menor
  (28 %), mas o resultado na verificação também.
- **Poucas revisões:** 24 por período; as diferenças entre variantes são pequenas face ao ruído.
- **Sem ordens:** não está ligada à Automação. A revisão seguinte aparece na página para decisão manual.
