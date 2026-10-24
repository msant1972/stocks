# Código partilhado

Módulos JavaScript puros (sem dependências) usados pelo frontend e pela API:

- `momentum.js`: indicador de momento (SMA10/SMA200 e SMA8/SMA125) sobre as cotações diárias;
- `strategies/`: estratégias simuladas no histórico. `index.js` é o registo (id, nome, regras, `run`, e o formato do resultado que todas devolvem); `a-momentum.js` é a A-Momentum (compras, reforços e vendas sobre o momento SMA10/SMA200); `b-opus.js` é a B-Opus (tendência e momentum ajustado ao risco, decisão semanal, stop chandelier), com os seus indicadores (ATR e ADX de Wilder, M2, Efficiency Ratio, CMF) exportados para teste. `c-ai.js` é a C-AI (tendência acima da SMA200 com M2 positivo, stop chandelier de 5 × ATR, reforços só com momentum forte), que reutiliza os indicadores da B-Opus.
- `promessas.js`: sinais e pontuação do módulo Promessas (elegibilidade pela tendência dos últimos 3 meses; percentis de M2, volatilidade de 3 meses e inclinação da SMA200), validados em [docs/arquitectura/promessas.md](../docs/arquitectura/promessas.md).

O frontend importa-os através de `frontend/src/lib/`; a API usa-os nos Sinais (`/api/v1/signals`), no BackTest (`/api/v1/backtest`), no WinnersLoosers (`/api/v1/winners-losers`) e nas Promessas (`/api/v1/promessas`). Os testes estão em `frontend/test/`.
