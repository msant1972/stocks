# Estratégia E-Ondas

> Especificação da estratégia E-Ondas para a aplicação Stocks (11 nov. 2026), **implementada a 12 nov. 2026** em `shared/strategies/e-ondas.js` (testes em `frontend/test/e-ondas.test.js`, com as cotações da A2A.MI em `frontend/test/fixtures/a2a-mi.json`: as mesmas 6 compras, 5 vendas e +3 212 € do protótipo). Nasceu de um desenho do
> utilizador sobre o gráfico de 2 anos da A2A.MI (compras C nos fundos das correcções e vendas V nos topos): as regras
> abaixo são a melhor aproximação, sem ver o futuro, a esses pontos. É uma estratégia **por instrumento**, como as
> outras: cada instrumento é simulado isoladamente, com o mesmo orçamento por compra. Descrição metodológica para estudo
> e simulação; não constitui recomendação de investimento.

## 1. Ideia

Numa acção em tendência de subida, o preço avança em ondas, com correcções que muitas vezes vêm testar a zona da SMA200.
A E-Ondas tenta apanhar cada onda: **compra quando uma correcção acaba, perto da SMA200, e vende quando a subida seguinte
acaba**. Como não vê o futuro, só reconhece o fundo e o topo depois de o preço se afastar deles: compra cerca de 5 %
acima do fundo e vende cerca de 4 % abaixo do topo.

## 2. Princípios (como as outras estratégias)

1. Módulo JavaScript puro, sem dependências, em `shared/strategies/e-ondas.js`, registado em `shared/strategies/index.js`:
   o mesmo código no browser (Charts) e no servidor (BackTest, Comparar, Sinais, Automação).
2. Sem *lookahead*: a decisão no fecho da sessão t usa apenas dados até ao fecho de t.
3. Resultados determinísticos.
4. Decisões sobre o **fecho ajustado**; execução e resultados ao **fecho real** da sessão do sinal (como a A-Momentum:
   `execution: 'close'` no registo).
5. 15 000 € por compra, quantidades inteiras, uma posição de cada vez, **sem reforços e sem stop** (só um limite de tempo, desde 13 nov. 2026).
6. Janela: actua nos últimos 2 anos (`windowYears: 2`), com 1 ano de aquecimento (`warmupYears: 1`) para a SMA200 e a sua
   inclinação; o período de verificação do BackTest funciona como nas outras.

## 3. Indicadores (calculados pela estratégia, sobre o fecho ajustado C)

| Indicador | Definição |
|---|---|
| SMA200 | média simples dos últimos 200 fechos ajustados |
| Inclinação da SMA200 | `SMA200_t / SMA200_(t−20) − 1` |
| Distância à SMA200 | `C_t / SMA200_t − 1` |
| Correcção de 20 sessões (dd20) | `C_t / max(C_(t−19..t)) − 1` |

Sem SMA200 de há 20 sessões (início da série), a sessão não pode gerar compra.

## 4. Regras

**Sem posição: procura de compra**

- `low` = fecho ajustado mais baixo desde a última venda (ou desde o início da janela); `lowDay` = sessão desse mínimo.
  Em cada sessão, se `C_t < low`, então `low = C_t`, `lowDay = t`.
- **Compra ao fecho de t** quando `C_t ≥ low × (1 + UP)` e, ao mesmo tempo:
  1. a SMA200 está a subir: inclinação de 20 sessões `> 0` em t;
  2. no `lowDay`, houve correcção: `dd20(lowDay) ≤ −MIN_DIP`;
  3. no `lowDay`, o preço estava perto ou abaixo da SMA200: `distância à SMA200(lowDay) ≤ NEAR_200`.
- Se `C_t ≥ low × (1 + UP)` mas alguma condição falha, o mínimo é esquecido: `low = C_t`, `lowDay = t`, e a procura
  recomeça a partir daí (não se compra muito depois de um fundo antigo).

**Com posição: procura de venda**

- `high` = fecho ajustado mais alto desde a compra (começa no fecho ajustado da compra).
- **Vende tudo ao fecho de t** quando `C_t ≤ high × (1 − DOWN)` **e** `high ≥ compra × (1 + MIN_GAIN)` (até o máximo chegar
  a +4 % sobre o preço de compra, a posição aguenta as oscilações).
- **Limite de tempo (desde 13 nov. 2026):** se, `MAX_HOLD` (120) sessões depois da compra, o máximo ainda não chegou a +4 % sobre o preço de compra, **vende tudo ao fecho** (a onda não aconteceu). Depois de o máximo lá chegar, o limite deixa de se aplicar e só a inversão vende.
- Depois da venda: `low = C_t`, `lowDay = t`.

**Sinais** (marcadores do gráfico, página Sinais, Automação): `buy` e `sell` na data da sessão da decisão, com o preço do
fecho real; motivo da venda `reversal` («inversão») ou `time` («limite de tempo»).

## 5. Parâmetros (`DEFAULT_OPTIONS`)

| Parâmetro | Valor | O que controla |
|---|---|---|
| `budget` | 15 000 € | orçamento por compra |
| `up` (UP) | 0,05 | subida desde o mínimo que confirma o fundo |
| `down` (DOWN) | 0,04 | queda desde o máximo que confirma o topo |
| `minGain` (MIN_GAIN) | 0,04 | ganho mínimo do máximo sobre a compra antes de poder vender |
| `minDip` (MIN_DIP) | 0,03 | correcção mínima no dia do mínimo (face ao máximo de 20 sessões) |
| `near200` (NEAR_200) | 0,03 | distância máxima à SMA200 no dia do mínimo |
| `maxHold` (MAX_HOLD) | 120 | sessões máximas com a posição sem o máximo chegar a `minGain` (0 = sem limite) |
| `slopeN` | 20 | sessões da inclinação da SMA200 |
| `smaTrend` | 200 | período da média de tendência |

## 6. Algoritmo de referência

Protótipo usado nos testes (simplificado; a implementação deve seguir o formato comum do registo: `trades`, `open`,
`signals`, `firstDate`, `summary` com `buyHold`, e devolver os `lots` de cada operação para os custos):

```js
for (let i = 0; i < bars.length; i++) {
  const x = features[i];                 // null durante o aquecimento (sem SMA200 de há 20 sessões)
  if (!x || bars[i].date < from) continue;
  const c = x.adjClose; const price = bars[i].closeRaw;
  if (!pos) {
    if (low == null || c < low) { low = c; lowI = i; }
    if (c >= low * (1 + o.up)) {
      const L = features[lowI];
      if (x.slope200 > 0 && L.dd20 <= -o.minDip && L.dist200 <= o.near200) {
        pos = buy(i, price, c);          // 15 000 € / preço, inteiro
        high = c;
      } else { low = c; lowI = i; }      // fundo antigo esquecido
    }
    continue;
  }
  high = Math.max(high, c);
  if (c <= high * (1 - o.down) && high >= pos.adj * (1 + o.minGain)) {
    sell(i, price);                      // venda total ao fecho real
    low = c; lowI = i;
  }
}
```

## 7. Evidência (testes de 11 nov. 2026)

**Pontos do utilizador na A2A.MI** (mínimos e máximos do fecho ajustado mais próximos das marcas do gráfico):
C 13 nov. 2024 · V 17 jan. 2025 · C 9 abr. 2025 · V 13 jun. 2025 · C 18 set. 2025 · V 6 nov. 2025 · C 17 dez. 2025 ·
V 11 fev. 2026 · C 23 mar. 2026 · V 10 abr. 2026 · C 7 out. 2026 (em aberto).

**Como se chegou às regras.** Nos 11 pontos, as compras são sempre com a SMA200 a subir, numa correcção (4 a 17 % abaixo
do máximo de 20 sessões, abaixo da SMA50, z20 ≤ −0,9) e perto da SMA200; as vendas, no máximo de 20 sessões, esticadas
(z20 ≥ 1,6, RSI14 ≥ 65, 9 a 24 % acima da SMA200). Duas famílias de regras foram comparadas pelo F1 (pontos apanhados a
±8 sessões contra sinais a mais) e pelo resultado:

- limiares fixos (comprar com z20 baixo perto da SMA200, vender com z20, RSI e distância altos): no máximo 5 de 11 pontos;
  uma compra antecipada prende a posição e perde as compras seguintes;
- **inversão confirmada (a escolhida):** 8 de 11 pontos, 3 sinais a mais, F1 0,73.

**A2A.MI (2 anos)**: compras 14 abr. 2025, 30 set. 2025, 7 jan. 2026, 16 mar. 2026, 21 mai. 2026, 13 out. 2026 (aberta);
operações fechadas +10,8 %, +10,4 %, +3,5 %, −0,2 %, −0,9 %.

**Catálogo (329 instrumentos activos, com os custos estimados da SAXO, `shared/costs.js`):**

| | Últimos 2 anos | Verificação (2022–2024) |
|---|---|---|
| Resultado | 478 k€ (517 k€ sem custos) | 270 k€ (306 k€ sem custos) |
| Sobre o capital investido | 10,7 % | 6,0 % |
| Instrumentos com ganho/perda | 216/81 | 208/90 |
| Operações · acerto | 702 · 76 % | 655 · 75 % |
| 10 piores instrumentos | −60 k€ | −82 k€ |

Referências na mesma medição (com custos, sobre o capital): C-AI 14,7 % e 3,2 %; A-Momentum 11,9 % e 5,9 %; D-Reversão
4,5 % e 1,8 %; B-Opus 6,9 % e −0,1 %. A E-Ondas é a mais regular (mais de 70 % dos instrumentos com ganho nos dois
períodos) e a melhor no período de verificação, que não serviu para afinar nada; o total em euros é menor porque investe
15 000 € de cada vez, sem reforços.

**Stop de protecção testado e rejeitado** (com custos): 8 % → 7,7 % e 2,9 %; 10 % → 8,3 % e 2,8 %; 15 % → 8,8 % e 3,8 %
(últimos 2 anos e verificação), contra 10,7 % e 6,0 % sem stop.

**Limite de tempo (13 nov. 2026).** A análise das operações mostrou que os bons números das operações fechadas (acerto de 76 %)
escondiam as perdedoras, que nunca fechavam por nunca chegarem a +4 %: 184 posições abertas com −162 k€, 56 delas abaixo de −10 %
(−210 k€; na verificação 60 e −240 k€). Testes no catálogo, com custos, sobre o capital (últimos 2 anos / verificação):

| Variante | Resultado | Abertas abaixo de −10 % | 10 piores |
|---|---|---|---|
| Sem limite (regras anteriores) | 10,4 % / 4,9 % | 56 (−210 k€) / 60 (−240 k€) | −60 k€ / −83 k€ |
| Vender com a SMA200 a descer | 6,9 % / 1,5 % | 5 / 5 | −51 k€ / −59 k€ |
| Vender 8 % abaixo da SMA200 | 6,1 % / 2,4 % | 1 / 3 | −51 k€ / −56 k€ |
| Limite de 90 sessões | 9,9 % / 4,3 % | 16 / 16 | −50 k€ / −57 k€ |
| **Limite de 120 sessões (adoptado)** | **10,2 % / 4,9 %** | **18 (−42 k€) / 24 (−67 k€)** | **−49 k€ / −61 k€** |
| Limite de 180 sessões | 9,8 % / 5,4 % | 26 / 33 | −57 k€ / −61 k€ |

O resultado fica igual e as perdas escondidas caem cerca de 75 %; o acerto das fechadas desce para 69 %, porque as perdedoras passam a
fechar. Os números das secções anteriores (702 operações, 76 %) são os de antes do limite.

## 8. Limitações e riscos

- **Sem stop de preço:** uma compra seguida de uma queda prolongada, sem recuperar 4 %, fica aberta até ao limite de 120 sessões (cerca de 6 meses) e a perda pode crescer até lá.
- **Parâmetros de um só instrumento** (os pontos do utilizador na A2A.MI); a regularidade no catálogo e no período de
  verificação é bom sinal, não garantia.
- **Atraso** de cerca de 5 % depois do fundo e 4 % depois do topo; ondas pequenas (menos de cerca de 10 %) dão pouco ou nada.
- Com a SMA200 a descer não compra (fora do mercado nas tendências de queda).
- Catálogo de hoje: as empresas que saíram da bolsa não entram nos testes.
- Na Automação, como na A-Momentum, um sinal da sessão em curso usa o fecho provisório e pode desaparecer até ao fecho.

## 9. Plano de implementação (feito a 12 nov. 2026)

1. `shared/strategies/e-ondas.js`: `DEFAULT_OPTIONS`, `resolveOptions`, `backtest(quotes, { from, ...options })` no formato
   comum (com `lots`, `proceeds`, `pnl`, `buyHold`, `firstDate`, `signals`), usando `prepare` de `b-opus.js` para a série
   ajustada.
2. Registo (`shared/strategies/index.js`): `id: 'e-ondas'`, `name: 'E-Ondas'`, `execution: 'close'`, `windowYears: 2`,
   `warmupYears: 1`, `budget`, `summary`, `rules` (texto a partir dos parâmetros), `reasonLabels: { reversal: 'inversão' }`.
3. Testes (`frontend/test/e-ondas.test.js`): compra só com SMA200 a subir, correcção e mínimo perto da SMA200; fundo
   esquecido quando as condições falham; venda só depois de +4 % e com 4 % de queda do máximo; sem lookahead; resultado
   igual ao protótipo na A2A.MI (os 6 sinais de compra da secção 7).
4. Verificar no BackTest, Comparar (incluindo «A classificação aguenta?»), Sinais, Charts (marcadores C e V e painel da
   simulação) e WinnersLoosers (a E-Ondas passa a contar em «todas as estratégias»: confirmar se é o desejado).
5. Automação: estratégia disponível, desligada (o utilizador decide se a liga).
6. Laboratório: passar a experiência «E-Ondas» de ideia a a decorrer; documentação (arquitectura, plano, guia de estilos).
