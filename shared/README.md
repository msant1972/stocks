# Código partilhado

Módulos JavaScript puros (sem dependências) usados pelo frontend e pela API:

- `momentum.js`: indicador de momento (SMA10/SMA200 e SMA8/SMA125) sobre as cotações diárias;
- `strategies/`: estratégias simuladas no histórico. `index.js` é o registo (id, nome, regras, `run`, e o formato do resultado que todas devolvem); `a-momentum.js` é a A-Momentum (compras, reforços e vendas sobre o momento SMA10/SMA200); `b-opus.js` é a B-Opus (tendência e momentum ajustado ao risco, decisão semanal, stop chandelier), com os seus indicadores (ATR e ADX de Wilder, M2, Efficiency Ratio, CMF) exportados para teste.

O frontend importa-os através de `frontend/src/lib/`; a API usa-os nos sinais (`/api/v1/signals`) e no BackTest (`/api/v1/backtest`). Os testes estão em `frontend/test/`.
