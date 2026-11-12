/**
 * SAXO Bank falsa, dentro do processo da API (cfg.saxo.fetchImpl). Guarda as ordens recebidas e mexe no saldo e nas
 * posições como a conta de simulação: uma compra limitada é executada logo ao preço limite, uma venda a mercado ao último
 * preço conhecido. Expõe o estado em /__saxo (só neste servidor de teste) para os testes confirmarem o que chegou.
 */
export function createFakeSaxo({ cash = 300000, positions = [], prices = {} } = {}) {
  const state = { cash, positions: positions.map((p) => ({ ...p })), orders: [], prices };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const positionsValue = () => state.positions.reduce((s, p) => s + p.amount * (state.prices[p.uic] ?? p.openPrice), 0);

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/sim\/openapi/, '');
    const method = init.method ?? 'GET';
    if (p === '/port/v1/accounts/me') return json({ Data: [{ AccountKey: 'acc-e2e', AccountId: 'E2E-1', Currency: 'EUR', Active: true, IsTrialAccount: true }] });
    if (p === '/port/v1/users/me') return json({ ClientKey: 'client-e2e', Name: 'Teste' });
    if (p === '/port/v1/balances/me') {
      const pv = positionsValue();
      return json({ CashBalance: state.cash, TransactionsNotBooked: 0, NonMarginPositionsValue: pv, TotalValue: state.cash + pv, Currency: 'EUR' });
    }
    if (p === '/port/v1/positions/me') {
      return json({ Data: state.positions.filter((x) => x.amount > 0).map((x, i) => ({
        PositionId: String(1000 + i), PositionBase: { Uic: x.uic, Amount: x.amount, AssetType: 'Stock', OpenPrice: x.openPrice, Status: 'Open', ExecutionTimeOpen: x.openedAt },
        PositionView: { CurrentPrice: state.prices[x.uic] ?? x.openPrice }, DisplayAndFormat: { Currency: 'EUR', Symbol: x.symbol, Description: x.symbol },
      })) });
    }
    if (p === '/port/v1/closedpositions/me') return json({ Data: [] });
    if (p === '/port/v1/orders/me') return json({ Data: [] }); // as ordens executam-se logo: nenhuma fica aberta
    if (p === '/cs/v1/audit/orderactivities') {
      const o = state.orders.find((x) => x.id === u.searchParams.get('OrderId'));
      return json({ Data: o ? [{ OrderId: o.id, Status: 'FinalFill', FilledAmount: o.body.Amount, AveragePrice: o.price, ActivityTime: new Date().toISOString() }] : [] });
    }
    if (p === '/ref/v1/exchanges') return json({ Data: [{ ExchangeId: 'LISB', Mic: 'XLIS' }] });
    if (p === '/trade/v2/orders' && method === 'POST') {
      const body = JSON.parse(init.body);
      const price = body.OrderType === 'Limit' ? body.OrderPrice : (state.prices[body.Uic] ?? 10);
      const id = String(7000 + state.orders.length);
      state.orders.push({ id, body, price });
      const pos = state.positions.find((x) => x.uic === body.Uic);
      if (body.BuySell === 'Buy') {
        state.cash -= body.Amount * price;
        if (pos) { pos.openPrice = (pos.openPrice * pos.amount + price * body.Amount) / (pos.amount + body.Amount); pos.amount += body.Amount; }
        else state.positions.push({ uic: body.Uic, amount: body.Amount, openPrice: price, symbol: String(body.Uic) });
      } else if (pos) {
        state.cash += body.Amount * price;
        pos.amount -= body.Amount;
      }
      return json({ OrderId: id });
    }
    return json({ Message: `rota não simulada: ${method} ${p}` }, 404);
  }
  return { state, fetchImpl };
}
