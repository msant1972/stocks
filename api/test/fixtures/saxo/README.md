# Fixtures da API da SAXO Bank (SIM)

Respostas reais do ambiente de simulação (`https://gateway.saxobank.com/sim/openapi`), gravadas a 2026-11-03 no *spike*
da ligação à SAXO (plano em docs/arquitectura). Chaves, identificadores e nome da conta foram anonimizados. Cada ficheiro
tem `{ status, body }`. Notas do spike:

- Símbolo da SAXO: `RAIZ:mic` em minúsculas (`GALP:xlis`); `ExchangeId` da SAXO (LISB, PAR, AMS, BRU, MIL, FSE…) liga-se
  ao MIC pelo campo `Mic` de `/ref/v1/exchanges` (`exchanges-eur.json`).
- `Keywords` da pesquisa aceita o ISIN (`instruments-isin.json`).
- Preços sem acesso no SIM: `PriceTypeBid/Ask = NoAccess` (`infoprices-galp.json`).
- `precheck` e envio partilham o limite de 1 pedido/s (`rate-limited.json`); o cancelamento tem 3/s.
