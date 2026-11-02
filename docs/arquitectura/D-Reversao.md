# D-Reversão — Estratégia de reversão à média

> Especificação da estratégia D-Reversão para a aplicação Stocks, definida a partir da análise dos instrumentos que perdem com as estratégias de tendência (WinnersLoosers, 2 nov. 2026). A D-Reversão é uma estratégia **por instrumento**, como as outras: cada instrumento é simulado isoladamente, com o mesmo orçamento por compra e sem comissões. Descrição metodológica para estudo e simulação; não constitui recomendação de investimento.
>
> Estado: **implementada a 2 nov. 2026** em `shared/strategies/d-reversao.js` (+250 k€, 215 instrumentos com ganho e 78 com perda, sobre os dados de produção).

---

## 1. Resumo

As ações oscilam em torno de um valor médio. Depois de uma queda anormal em poucos dias (notícia, vendas em pânico, um vendedor grande), o preço tende a exagerar e a recuperar parte da queda. A D-Reversão compra nesse exagero e vende no ressalto, sem depender de haver tendência:

- **Entrada (qualquer sessão):** sem posição, quando o fecho ajustado fica mais de 2,5 desvios-padrão abaixo da média das últimas 20 sessões (z < −2,5), compra 15 000 € na abertura da sessão seguinte.
- **Saída:** vende tudo na abertura seguinte quando o RSI de 2 sessões passa 70 (motivo `rebound`, «ressalto») ou ao fim de 10 sessões sem ressalto (motivo `time`, «tempo»).
- **Sem stop nem reforços**, uma posição de cada vez, sem comissões.

| | A-Momentum, B-Opus, C-AI (tendência) | D-Reversão |
|---|---|---|
| Compra quando | o preço sobe e a subida se confirma | o preço cai de forma anormal |
| Duração das posições | semanas a meses | poucos dias |
| Ganha com | subidas longas e regulares | ressaltos depois de quedas fortes |
| Sofre com | acções laterais (falsas tendências) | acções em queda contínua |

## 2. Convenções

As mesmas da C-AI: decisão no fecho de t só com dados até t; execução na abertura da sessão seguinte; indicadores sobre a série ajustada (OHLC × fecho ajustado ÷ fecho, `prepare` de `b-opus.js`); preços de execução e resultados em preços reais; um indicador sem dados suficientes é `null` e o critério que dele depende falha.

## 3. Indicadores

| Indicador | Definição |
|---|---|
| z | `(C_t − SMA20_t) / desvio-padrão amostral dos últimos 20 fechos ajustados` (`rollingMean` de `momentum.js`, `rollingStd` de `b-opus.js`) |
| RSI2 | RSI de Wilder com n = 2: semente na média dos 2 primeiros ganhos e perdas; depois `média = (média × (n − 1) + valor) / n` |

## 4. Sequência de cada sessão t

**Abertura:** (1) venda planeada a `O_t`; (2) compra planeada: `floor(15 000 / O_t real)` unidades (0 → cancelada).
**Fecho:** com posição: se `RSI2_t > 70` planeia a venda (`rebound`); senão, se passaram 10 sessões desde a compra, planeia a venda (`time`). Sem posição, a partir de `from` e com 20 sessões: se `z_t < −2,5` planeia a compra.
**Sinais:** `buy` na sessão da compra e `sell` (com o motivo) na da venda, com o preço real.

## 5. Integração

Registo (`shared/strategies/index.js`), entrada `d-reversao`: `windowYears: 2`, `warmupYears: 1` (a janela de 2 anos fica toda activa; o aquecimento real é de 20 sessões), `reasonLabels: { rebound: 'ressalto', time: 'tempo' }`. `run` devolve o formato comum do registo, com `exitReasons` e `options` como campos próprios. Funciona sem outras alterações no menu «Estratégia» da página do instrumento, no gráfico (marcadores C e V), no painel, no BackTest, nos Sinais e no WinnersLoosers (que passa a classificar com as quatro estratégias).

## 6. Opções

```js
export const DEFAULT_OPTIONS = {
  budget: 15000,   // EUR por compra
  meanN: 20,       // média e desvio-padrão do z
  zEntry: -2.5,    // compra com z abaixo disto
  rsiN: 2,
  rsiExit: 70,     // vende com o RSI acima disto
  maxHold: 10,     // sessões máximas com a posição (0 = sem limite)
};
```

Validadas como nas outras estratégias (chaves desconhecidas, tipos e valores negativos → erro; só `zEntry` pode ser negativo).

## 7. Evidência (análise de 2 nov. 2026)

295 instrumentos activos, três anos de cotações (o primeiro de aquecimento), estratégia avaliada nos últimos dois.

**Porque surgiu.** Os 75 instrumentos que perdem com as três estratégias de tendência (−722 k€) não são mais voláteis do que os ganhadores (≈ 28% ao ano), mas não têm tendência: cruzam a SMA200 22 vezes em dois anos (8 nos ganhadores), estão acima dela 47% do tempo (84%) e têm uma eficiência da tendência (ER) de 0,025 (0,089). As estratégias de tendência compram recuperações que falham: acerto de 8% (A-Momentum) a 25% (C-AI), compras em mediana 15–47 sessões depois de o preço passar a SMA200. Nos 29 perdedores em que comprar e manter subiu, a subida veio de poucos saltos imprevisíveis (os 5 melhores dias valem 174% da subida), com as estratégias de fora.

**Resultados.**

| | Resultado | Com ganho / perda |
|---|---|---|
| Catálogo (295) | +250 k€ | 215 / 78 |
| Perdedores das estratégias de tendência (75) | +42 k€ (eram −722 k€) | 51 / 24 |
| 1.º ano, só | +196 k€ | 200 / 77 |
| 2.º ano, só, a começar sem posição | +58 k€ | 174 / 96 |
| Com comissões de 0,1% por lado | +212 k€ | 205 / 88 |

1 268 operações em dois anos, 66% com ganho, ganho médio de +1,3% por operação; investida cerca de 5% do tempo (≈ 55% ao ano sobre o capital enquanto investido). Saídas: 1 130 por ressalto, 138 por tempo.

**Variantes testadas** (48: entrada RSI2 < 10 ou < 5, z < −2 ou < −2,5; saída acima da SMA5, RSI2 > 70 ou acima da SMA20; filtros de regime acima da SMA200, lateral e ER baixo): a escolhida é a mais robusta, com poucas operações. RSI2 < 10 com saída na SMA20 soma mais (+499 k€), mas faz 6 700 operações e, com comissões, deixa de ganhar nos perdedores. Exigir o preço acima da SMA200 põe os perdedores a perder. Prazos de 5 ou 20 sessões e stops de 8% ou 15% mudam pouco o resultado.

## 8. Limitações e riscos

- **Período curto e de subida:** as quedas tenderam a recuperar; num mercado em queda prolongada os ressaltos são mais fracos.
- **Quedas com razão de fundo** (resultados, revisões) não recuperam: a pior operação perdeu 21%; nas acções que caíram mais de 15% em dois anos o resultado é nulo (25 de 41 com ganho).
- **Viés de sobrevivência:** o catálogo só tem acções que existem hoje, o que favorece comprar quedas.
- **Complemento, não substituto:** nos ganhadores rende muito menos do que as estratégias de tendência, porque vende logo no ressalto.

## 9. Critérios de aceitação

1. `shared/strategies/d-reversao.js` implementa as secções 3 e 4 com as opções da secção 6, sem dependências nem aleatoriedade, reutilizando `prepare`, `rollingStd` e `rollingMean`.
2. Registada com `available: true`; aparece no menu «Estratégia» da página do instrumento, do BackTest e dos Sinais, e conta no WinnersLoosers e na «melhor estratégia» de Acompanhar.
3. Testes automáticos (`frontend/test/d-reversao.test.js`): opções; RSI e z; compra na abertura seguinte com z < −2,5 e 15 000 €; venda por ressalto e por tempo; preços reais com fecho ajustado; respeito por `from`; sem lookahead; formato comum.
4. Sobre os dados de produção, o resultado coincide com a análise (+250 k€, 215/78; perdedores +42 k€).
