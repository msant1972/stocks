# Fixtures da API da SAXO Bank (SIM)

Respostas reais do ambiente de simulação (`https://gateway.saxobank.com/sim/openapi`), gravadas a 2026-11-03 no *spike*
da ligação à SAXO (plano em docs/arquitectura). Chaves, identificadores e nome da conta foram anonimizados. Cada ficheiro
tem `{ status, body }`. Notas do spike:

- Símbolo da SAXO: `RAIZ:mic` em minúsculas (`GALP:xlis`); `ExchangeId` da SAXO (LISB, PAR, AMS, BRU, MIL, FSE…) liga-se
  ao MIC pelo campo `Mic` de `/ref/v1/exchanges` (`exchanges-eur.json`).
- `Keywords` da pesquisa aceita o ISIN (`instruments-isin.json`).
- Preços sem acesso no SIM: `PriceTypeBid/Ask = NoAccess` (`infoprices-galp.json`).
- `precheck` e envio partilham o limite de 1 pedido/s (`rate-limited.json`); o cancelamento tem 3/s.

- `positions-empty.json` é real (a conta SIM não tinha posições). `positions-synthetic.json` é **construído à mão** segundo a documentação da SAXO
  (PositionBase/PositionView/DisplayAndFormat), para testar a Carteira SAXO; no SIM sem preços `CurrentPrice` vem a 0.
- `orderactivities-*.json` (2026-11-04): histórico de uma ordem em `/cs/v1/audit/orderactivities?ClientKey&OrderId`, com os estados reais
  vistos no SIM (`Placed`, `FinalFill` com `FilledAmount`/`AveragePrice`, `Expired`, `Cancelled`); anonimizados e reduzidos à mesma ordem.
- Spike de 2026-11-04: a pré-validação aceita uma compra com ordem associada em `Orders` (`StopIfTraded` com `OrderPrice`, ou
  `TrailingStopIfTraded` com `TrailingStopDistanceToMarket` e `TrailingStopStep`), devolvendo `PreCheckResult: Ok`. O streaming
  (`wss://sim-streaming.saxobank.com/sim/oapi/streaming/ws/connect?contextId&authorization=BEARER …`) liga com o WebSocket do Node e
  `POST /port/v1/orders/subscriptions` devolve o snapshot das ordens abertas (ordens associadas vêm em `RelatedOpenOrders`).
