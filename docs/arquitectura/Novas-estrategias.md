# Estratégias G a L (por instrumento) e fatores

> Implementadas a 14 nov. 2026 a partir da revisão técnica: `shared/strategies/{g-donchian,h-cruzamento,i-maximo52,j-bollinger,k-keltner,l-macd}.js`,
> com o motor comum `shared/strategies/single.js`. Testes em `frontend/test/novas-estrategias.test.js`. Os resultados e a afinação estão no
> Laboratório (experiências 33 a 38). Descrição metodológica para estudo e simulação; não constitui recomendação de investimento.

## 1. O que são

Seis estratégias clássicas que faltavam no registo, todas por instrumento, com decisão ao fecho e execução na abertura seguinte
(`execution: 'open'`), lotes de 15 000 €, uma posição de cada vez, sem reforços nem stop além da regra de saída, janela de 2 anos com 1 ano
de aquecimento:

| Id | Nome | Família | Regra (valores por omissão, depois da afinação) |
|---|---|---|---|
| `g-donchian` | G-Donchian | rotura de canais (Tartarugas) | compra o máximo das últimas **30** sessões; vende o mínimo das últimas **40** |
| `h-cruzamento` | H-Cruzamento | cruzamento de médias (referência) | compra quando a SMA50 cruza acima da SMA200; vende quando cruza abaixo |
| `i-maximo52` | I-Máximo52 | proximidade do máximo (George e Hwang) | compra a ≤ **10 %** do máximo de **126** sessões; vende **15 %** abaixo dele |
| `j-bollinger` | J-Bollinger | reversão nas bandas | compra abaixo da média de **40** sessões − **1,5** desvios; vende na média, ou ao fim de **80** sessões |
| `k-keltner` | K-Keltner | rotura de volatilidade | compra acima da EMA de **120** sessões + **1** × ATR(10); vende abaixo da EMA |
| `l-macd` | L-MACD | momentum de retalho | compra quando o MACD(12, 26, 9) cruza acima do sinal; vende quando cruza abaixo |

**Nascem desligadas** em Definições → Estratégias (migração `20261114000001`): ligadas, mudariam a «melhor estratégia» de cada instrumento e,
com ela, os instrumentos em que a Automação compra. O administrador liga as que quiser.

## 2. Resultados e afinação (catálogo de 328 instrumentos, com custos, sobre o capital; últimos 2 anos / verificação)

| | Por omissão (clássica) | Adoptada | Instrumentos com ganho | 10 piores | Operações |
|---|---|---|---|---|---|
| G-Donchian | 11,7 % / 3,2 % (55/20) | **18,7 % / 8,7 %** | 202 / 182 | −90 k€ / −94 k€ | 1 081 / 1 077 |
| H-Cruzamento | **14,8 % / 6,8 %** | igual (não se afinou) | 165 / 146 | −66 k€ / −87 k€ | 301 / 375 |
| I-Máximo52 | 12,5 % / 3,4 % (252, 5 %, 10 %) | **23,0 % / 11,4 %** | 211 / 182 | −77 k€ / −87 k€ | 977 / 717 |
| J-Bollinger | 6,7 % / 4,5 % (20, 2σ, 20) | **12,8 % / 5,8 %** | 263 / 220 | −92 k€ / −90 k€ | 2 229 / 2 019 |
| K-Keltner | 6,6 % / 0,6 % (EMA20, 2 ATR) | **21,2 % / 6,1 %** | 191 / 156 | −81 k€ / −80 k€ | 1 975 / 2 127 |
| L-MACD | **16,6 % / 2,5 %** | igual (não se afinou) | 214 / 179 | −93 k€ / −127 k€ | 6 400 / 6 212 |

**Como se afinou, e como se evitou o sobreajuste.** Grelhas de 16 a 93 combinações por estratégia, avaliadas nos dois períodos. Só se adopta uma
combinação que (1) melhora a por omissão nos **dois** períodos, (2) mantém pelo menos metade das operações (não degenera em comprar e manter),
(3) não piora os 10 piores em mais de 50 % e (4) fica no interior da grelha. Confirmou-se por validação cruzada (escolher num período e testar no
outro): para G, I, J e K a escolha é a mesma nos dois períodos; para H e L não generaliza (a melhor num período perde para a por omissão no outro),
por isso mantêm-se os valores clássicos. As combinações «melhores» absolutas (G 10/100: 33,7 % / 14,5 %; I 63/20 %/40 %: 38,8 % / 18,9 % com 40 operações)
foram rejeitadas: são comprar e manter com outro nome, e comprar e manter todo o catálogo rendeu 40,6 % / 20,2 %.

**Reservas.** Os dois períodos são de mercado em alta, o que favorece saídas largas e tempo no mercado; as afinadas têm perdas piores (10 piores
maiores) e a J-Bollinger fica com 23 posições abertas abaixo de −10 %. Nenhuma foi testada numa queda prolongada. O catálogo é o de hoje (viés
de sobrevivência).

## 3. Motor comum (`single.js`)

`runSingle(quotes, { from, budget, build })`: cada estratégia só descreve os indicadores e as regras (`build(bars) → { warm, decide(i, pos) }`); o
motor trata da execução à abertura seguinte, dos lotes, dos sinais, do comprar e manter e do formato comum do registo
(`trades`, `open`, `signals`, `summary`, `exitReasons`). Auxiliares: `ema`, `rollingMax`, `rollingMin` (com atraso) e `resolveNumeric` (validação das opções).

## 4. O que se fez com o resto da lista da revisão

- **Rotação por momentum relativo** (itens 1, 2 e 7): [Rotacao.md](Rotacao.md), com opções de janela (6, 9 ou 12 meses), filtro de regime de mercado
  (amplitude do catálogo acima da SMA200) e dimensionamento pela volatilidade, todas desligadas por omissão.
- **Filtro de regime** (item 2): testado na rotação, sem ganho nos dois períodos (só 2 de 24 revisões ficam em baixa); fica como opção.
- **Limite de carteira** (item 7): a rotação tem N posições; a Automação tem agora teto de posições e interruptor de perda máxima (ver arquitectura).
- **Fatores fundamentais** (item 8): cartão «Valor e qualidade» na página Rotação, **só informativo** (sem histórico de fundamentais por data, uma
  simulação teria viés de antecipação); `shared/fundamentals.js`.
