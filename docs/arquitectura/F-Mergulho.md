# Estratégia F-Mergulho

> Implementada a 14 nov. 2026 em `shared/strategies/f-mergulho.js` (testes em `frontend/test/f-mergulho.test.js`, com as cotações da
> ASML.AS em `frontend/test/fixtures/asml-as.json`). Desenhada a 13 nov. 2026 sobre a ASML.AS (Laboratório, experiência 31) e
> depois aplicada a todo o catálogo. Descrição metodológica para estudo e simulação; não constitui recomendação de investimento.

## 1. Ideia

Numa empresa de crescimento, as quedas fortes têm sido oportunidades de compra e a tendência longa paga a quem fica. A F-Mergulho
tem duas partes independentes, cada uma com lotes de 15 000 €: um **núcleo** que acompanha a tendência longa (SMA200) e até 3 lotes
de **mergulho** que compram fraqueza (RSI14 baixo) e vendem a recuperação.

## 2. Princípios (como as outras estratégias)

1. Módulo JavaScript puro, em `shared/strategies/f-mergulho.js`, registado em `shared/strategies/index.js`.
2. Sem *lookahead*: a decisão ao fecho de t usa só dados até t; execução na abertura da sessão seguinte (`execution: 'open'`), a
   preços reais; indicadores sobre o fecho ajustado.
3. 15 000 € por lote, quantidades inteiras. Janela de 2 anos com 1 ano de aquecimento (SMA200 e RSI14).
4. **Duas partes em simultâneo:** cada venda fecha uma operação (campo `leg`: `core` ou `dip`) e a posição aberta junta os lotes
   das duas partes. Capital máximo: 4 lotes (60 000 €).

## 3. Regras

**Núcleo (1 lote).** Compra quando o fecho fica mais de 3 % acima da SMA200 (200 sessões, fecho ajustado); vende quando fica mais
de 3 % abaixo (motivo `trend`).

**Mergulhos (até 3 lotes).**
- 1.º lote: compra quando o RSI14 de Wilder fecha abaixo de 40.
- 2.º e 3.º lotes: nova compra com RSI14 abaixo de 40, pelo menos 10 sessões depois da última compra de mergulho e com o fecho pelo
  menos 5 % abaixo do preço do último lote.
- Vende **todos** os lotes de mergulho quando: o RSI14 fecha acima de 70 (`rsi`, recuperação); ou o fecho está 20 % acima do custo
  médio (`target`); ou o fecho está 25 % abaixo do lote mais barato (`disaster`, protecção). A ordem de verificação é esta.

## 4. Parâmetros (`DEFAULT_OPTIONS`)

| Parâmetro | Valor | O que controla |
|---|---|---|
| `budget` | 15 000 € | orçamento por lote |
| `core` | 1 | núcleo ligado (0 = só mergulhos) |
| `smaTrend`, `coreBand` | 200, 0,03 | média de tendência e banda em torno dela |
| `rsiN`, `rsiIn`, `rsiOut` | 14, 40, 70 | RSI e limites de compra e de venda |
| `maxLots`, `spacing`, `step` | 3, 10, 0,05 | lotes de mergulho, espaçamento em sessões e descida entre lotes |
| `target`, `disaster` | 0,20, 0,25 | alvo sobre o custo médio e protecção abaixo do lote mais barato (0 = desligados) |

## 5. Evidência (simulações de 13 e 14 nov. 2026)

**ASML.AS** (1 286 sessões; fecho de 628 € para 1 340 € nos últimos 2 anos). Estudo de eventos: comprar fraqueza funcionou nos três
períodos (RSI14 abaixo de 35: +19,5 %, +8,6 % e +23,7 % nas 60 sessões seguintes); abertura/fecho e dia da semana sem vantagem estável.
Com custos estimados, últimos 2 anos: **+31 830 €**, capital máximo 44 145 €, 8 operações fechadas (7 ganhas), pior −8,3 %; verificação
(2022–2024): +3 782 €. Comprar e manter rendeu +114 % nos últimos 2 anos (queda máxima −27 %).

**Catálogo (329 instrumentos activos, com os custos estimados de `shared/costs.js`; sobre o capital, últimos 2 anos / verificação):**

| | F-Mergulho | A-Momentum | E-Ondas | C-AI | B-Opus | D-Reversão |
|---|---|---|---|---|---|---|
| Sobre o capital | **19,8 % / 9,2 %** | 18,4 % / 6,6 % | 12,5 % / 6,5 % | 14,9 % / 2,2 % | 11,1 % / 0,9 % | 4,5 % / 1,4 % |
| Resultado | 3 230 k€ / 1 497 k€ | 3 641 k€ / 1 000 k€ | 576 k€ / 302 k€ | 1 548 k€ / 170 k€ | 1 343 k€ / 83 k€ | 219 k€ / 67 k€ |
| Instrumentos com ganho | **254 / 219** | 174 / 123 | 200 / 178 | 201 / 148 | 142 / 98 | 221 / 189 |
| 10 piores | −226 k€ / −264 k€ | −161 k€ / −177 k€ | −47 k€ / −66 k€ | −78 k€ / −94 k€ | −80 k€ / −84 k€ | −37 k€ / −40 k€ |
| Posições abertas abaixo de −10 % | 29 / 54 | 7 / 12 | 15 / 22 | 1 / 1 | 0 / 0 | 2 / 0 |
| Operações · acerto | 1 988 · 64 % | 627 · 24 % | 864 · 60 % | 1 883 · 42 % | 2 410 · 37 % | 1 394 · 66 % |

É a melhor no período de verificação e a que tem mais instrumentos com ganho, mas as **piores perdas são as maiores** do registo
(os 10 piores −226 k€ e −264 k€) e fica com muitas posições abertas a perder.

## 6. Limitações e riscos

- **Quedas prolongadas:** os mergulhos compram cedo demais (ASML, nov. 2021 a jun. 2022: 3 lotes, −12 503 €, −28 %). A protecção de
  25 % só actua abaixo do lote mais barato.
- **Posições abertas a perder:** 29 (últimos 2 anos) e 54 (verificação) abaixo de −10 %, porque a venda do núcleo e dos mergulhos
  depende de condições que podem nunca chegar.
- **Mercado em alta:** os dois períodos de teste são de mercado em alta; um mercado em queda prolongada não está testado.
- **Saída sensível ao RSI de venda:** com 65 ou 70 funciona; com 75 o resultado da ASML em 5 anos cai de 44 k€ para 18 k€.
- **Automação:** uma venda na Automação fecha a posição inteira do instrumento na SAXO. Como a F-Mergulho vende o núcleo e os
  mergulhos em momentos diferentes, **não deve ser ligada na Automação** enquanto isso não for tratado (nasce desligada).
- Catálogo de hoje: as empresas que saíram da bolsa não entram nos testes.
- A condição de fundamentais do desenho original (EPS estimado acima do dos últimos 12 meses e preço abaixo do preço-alvo dos
  analistas) **não foi implementada**: a base de dados não guarda o histórico de estimativas.
