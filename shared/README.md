# Código partilhado

Módulos JavaScript puros (sem dependências) usados pelo frontend e pela API:

- `momentum.js`: indicador de momento (SMA10/SMA200 e SMA8/SMA125) sobre as cotações diárias;
- `strategy.js`: simulação da estratégia de momento no histórico (compras, reforços e vendas).

O frontend importa-os através de `frontend/src/lib/`; a API usa-os para gerar os sinais de todos os instrumentos (`/api/v1/signals`). Os testes estão em `frontend/test/`.
