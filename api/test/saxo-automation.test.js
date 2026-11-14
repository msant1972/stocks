import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildEligibility, buyLimit, buyQuantity, LAST_HOUR, lisbonClock, orderBudgetMs, ORDER_CUTOFF, runDueAutomation, runSlot, selectSignals, signalKey } from '../src/saxo/automation.js';
import { encryptSecret } from '../src/secrets.js';
import { api, hasTestDb, login, makeInstrument, makeUser, setup, TEST_SECRET_KEY } from './helpers.js';

describe('automação: regras', () => {
  it('recolha ao minuto 20 (08:20 a 16:20); Automação ao minuto 23 (08:23 a 16:23), até às 16:35 nas ordens, com a hora de Verão', () => {
    expect(lisbonClock(new Date('2026-11-06T08:23:00Z'))).toEqual({ date: '2026-11-06', time: '08:23', weekday: 'Fri' });
    expect(lisbonClock(new Date('2026-07-06T07:23:00Z')).time).toBe('08:23'); // UTC+1
    expect(runSlot({ time: '08:22', weekday: 'Fri' })).toBeNull();
    expect(runSlot({ time: '08:23', weekday: 'Fri' })).toBe(8);
    expect(runSlot({ time: '08:39', weekday: 'Fri' })).toBe(8);
    expect(runSlot({ time: '08:40', weekday: 'Fri' })).toBeNull();
    expect(runSlot({ time: '15:23', weekday: 'Fri' })).toBe(15);
    expect(runSlot({ time: '16:23', weekday: 'Fri' })).toBe(16); // a última: com a recolha das 16:20
    expect(runSlot({ time: '16:31', weekday: 'Fri' })).toBe(16);
    expect(runSlot({ time: '16:32', weekday: 'Fri' })).toBeNull(); // perto do limite das ordens (16:35)
    expect(runSlot({ time: '17:23', weekday: 'Fri' })).toBeNull();
    expect(runSlot({ time: '07:40', weekday: 'Fri' })).toBeNull();
    expect(runSlot({ time: '08:23', weekday: 'Sat' })).toBeNull();
    expect(LAST_HOUR).toBe(16);
    expect(ORDER_CUTOFF).toBe('16:35');
  });

  it('orçamento de tempo até ao limite das ordens (16:35)', () => {
    expect(orderBudgetMs('16:23')).toBe(12 * 60_000);
    expect(orderBudgetMs('16:35')).toBe(0);
    expect(orderBudgetMs('16:50')).toBe(0);
    expect(orderBudgetMs('08:23')).toBe((16 * 60 + 35 - (8 * 60 + 23)) * 60_000);
  });

  it('compra: limite = último preço + 1 % no passo de preço; quantidade pelo orçamento', () => {
    const scheme = { DefaultTickSize: 0.01, Elements: [{ HighPrice: 1e9, TickSize: 0.05 }] };
    expect(buyLimit('100')).toBe('101');
    expect(buyLimit('19.85')).toBe('20.0485');
    expect(buyLimit('19.85', scheme)).toBe('20.05');
    expect(buyQuantity(15000, '100')).toBe(150);
    expect(buyQuantity(15000, '20000')).toBe(0);
    expect(buyQuantity(15000, null)).toBe(0);
  });

  it('usa os sinais da sessão em curso e da última sessão; vendas primeiro', () => {
    const items = [
      { date: '2026-11-06', side: 'buy', symbol: 'HOJE.LS' },
      { date: '2026-11-05', side: 'buy', symbol: 'A.LS' },
      { date: '2026-11-05', side: 'sell', symbol: 'B.LS' },
      { date: '2026-11-04', side: 'buy', symbol: 'ANTIGO.LS' },
    ];
    expect(selectSignals(items, { lastFinal: '2026-11-05', today: '2026-11-06' }).map((s) => s.symbol)).toEqual(['B.LS', 'A.LS', 'HOJE.LS']);
  });

  it('a chave é igual em qualquer repetição e cabe no limite', () => {
    const k = signalKey({ instrumentId: 123456, date: '2026-11-06', side: 'sell' }, 'a-momentum');
    expect(k).toBe('auto-a-momentum-123456-20261106-sell');
    expect(k.length).toBeLessThanOrEqual(64);
  });
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

/** SAXO falsa: regista as ordens; `fail` força a resposta do envio; `positions` são as posições da conta. */
function fakeSaxo({ fail = null, positions = [] } = {}) {
  const orders = [];
  const fetchImpl = async (url, init) => {
    const p = new URL(url).pathname.replace('/sim/openapi', '');
    if (p === '/port/v1/accounts/me') return json({ Data: [{ AccountKey: 'acc', AccountId: '1', Currency: 'EUR', Active: true, IsTrialAccount: true }] });
    if (p === '/port/v1/orders/me') return json({ Data: orders.map((o) => ({ OrderId: o.id })) });
    if (p === '/port/v1/balances/me') return json({ CashBalance: 1000000, TotalValue: 1000000 });
    if (p === '/port/v1/positions/me') return json({ Data: positions.map(([uic, amount]) => ({ PositionId: `P${uic}`, PositionBase: { Uic: uic, Amount: amount, AssetType: 'Stock', OpenPrice: 10, Status: 'Open', ExecutionTimeOpen: '2026-11-04T09:30:00Z' }, DisplayAndFormat: { Currency: 'EUR' } })) });
    if (p === '/port/v1/closedpositions/me') return json({ Data: [] });
    if (p === '/ref/v1/exchanges') return json({ Data: [] });
    if (p === '/trade/v2/orders' && init.method === 'POST') {
      if (fail) return fail();
      const body = JSON.parse(init.body);
      const id = String(5000 + orders.length);
      orders.push({ id, body, requestId: init.headers['x-request-id'] });
      return json({ OrderId: id });
    }
    return json({}, 404);
  };
  return { fetchImpl, orders };
}

describe.skipIf(!hasTestDb)('automação: API e execução', () => {
  let ctx;
  let ana;
  let userId;
  let galp;
  const NOW = new Date('2026-11-06T08:35:00Z'); // sexta-feira, na execução das 08:33
  const FINAL = '2026-11-05';
  const signal = (over = {}) => ({ instrumentId: galp, symbol: 'GALP.LS', side: 'buy', reason: null, date: FINAL, lastClose: '10', ...over });
  // Por omissão todos os instrumentos são elegíveis (a regra da lista e da melhor estratégia testa-se à parte).
  const run = (signals, opts = {}) => runDueAutomation(ctx.pool, ctx.cfg, { now: NOW, loadSignals: async (st) => signals[st.id] ?? [], eligibility: async () => () => true, ...opts });
  const use = (over) => { const f = fakeSaxo(over); ctx.cfg.saxo.fetchImpl = f.fetchImpl; return f; };
  const turnOn = async (strategy = 'a-momentum') => {
    await ana.put('/saxo/automation', { enabled: true });
    await ana.put(`/saxo/automation/strategies/${strategy}`, { enabled: true });
  };
  const list = async () => (await ana.get('/saxo/automation/orders')).json().items;

  beforeAll(async () => {
    ctx = await setup();
    ctx.cfg.saxo.orderSpacingMs = 0;
    ctx.cfg.saxo.sleep = async () => {};
    ctx.cfg.testNoRateLimit = true;
    // As cotações dos testes têm datas fixas (Nov. 2026) e a idade da cotação conta-se contra o relógio real: sem isto, os
    // testes começavam a falhar quando passavam mais de maxQuoteAgeDays (7) dias sobre elas.
    ctx.cfg.maxQuoteAgeDays = 36_500;
    userId = await makeUser(ctx.pool, 'auto@exemplo.pt');
    ana = api(ctx.app, await login(ctx.app, 'auto@exemplo.pt'));
  });
  beforeEach(async () => {
    await ctx.pool.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['saxo_automation_runs', 'saxo_automation_orders', 'saxo_automation_strategies', 'saxo_automation_settings', 'saxo_orders', 'saxo_instruments', 'saxo_match_issues', 'user_integration_tokens', 'daily_quotes', 'instruments', 'job_runs']) {
      await ctx.pool.query(`TRUNCATE TABLE ${t}`);
    }
    await ctx.pool.query('SET FOREIGN_KEY_CHECKS = 1');
    await ctx.pool.query(
      `INSERT INTO user_integration_tokens (user_id, provider, token_enc, environment, auth_kind, refresh_token_enc, expires_at, refresh_expires_at)
       VALUES (?, 'saxo', ?, 'sim', 'oauth', ?, NOW(3) + INTERVAL 20 MINUTE, NOW(3) + INTERVAL 40 MINUTE)`,
      [userId, encryptSecret(TEST_SECRET_KEY, 'tok'), encryptSecret(TEST_SECRET_KEY, 'ref')],
    );
    galp = await makeInstrument(ctx.pool, 'GALP.LS', { closes: ['10', '10'], sessions: [FINAL, '2026-11-06'] });
    await ctx.pool.query(
      `INSERT INTO saxo_instruments (instrument_id, environment, uic, saxo_symbol, exchange_id, currency, description, tradable, order_types, min_size, tick_scheme)
       VALUES (?, 'sim', 23737, 'GALP:xlis', 'LISB', 'EUR', 'Galp', 1, 'Market,Limit', 1, ?)`,
      [galp, JSON.stringify({ DefaultTickSize: 0.01, Elements: [{ HighPrice: 1e9, TickSize: 0.01 }] })],
    );
    await ctx.pool.query(
      `INSERT INTO job_runs (kind, status, started_at, finished_at) VALUES
       ('fetch_update', 'done', '2026-11-05 19:01:00', '2026-11-05 19:10:00'), ('fetch_intraday', 'done', '2026-11-06 08:23:00', '2026-11-06 08:28:00')`,
    );
    await ctx.pool.query('UPDATE daily_quotes SET fetched_at = NOW(3)');
    use();
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('começa desligada; os interruptores guardam-se e auditam-se', async () => {
    const off = (await ana.get('/saxo/automation')).json();
    expect(off.enabled).toBe(false);
    expect(off.strategies.map((s) => s.id)).toEqual(expect.arrayContaining(['a-momentum', 'b-opus', 'c-ai', 'd-reversao']));
    expect(off.strategies.every((s) => !s.enabled)).toBe(true);
    await turnOn('c-ai');
    const on = (await ana.get('/saxo/automation')).json();
    expect(on.enabled).toBe(true);
    expect(on.strategies.find((s) => s.id === 'c-ai').enabled).toBe(true);
    expect(on.strategies.find((s) => s.id === 'b-opus').enabled).toBe(false);
    const [audits] = await ctx.pool.query("SELECT action FROM audit_log WHERE action LIKE 'saxo.automation%'");
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect((await ana.put('/saxo/automation/strategies/nao-existe', { enabled: true })).statusCode).toBe(400);
  });

  it('desligada, ou só com o interruptor geral, ou só com a estratégia, não envia nada', async () => {
    const f = use();
    const signals = { 'a-momentum': [signal()] };
    expect(await run(signals)).toBe(0);
    await ana.put('/saxo/automation', { enabled: true });
    expect(await run(signals)).toBe(0);
    await ana.put('/saxo/automation', { enabled: false });
    await ana.put('/saxo/automation/strategies/a-momentum', { enabled: true });
    expect(await run(signals)).toBe(0);
    expect(f.orders).toHaveLength(0);
  });

  it('só liga a estratégia escolhida; fora da janela não corre', async () => {
    const f = use();
    await turnOn();
    const signals = { 'a-momentum': [signal()], 'c-ai': [signal({ side: 'add' })] };
    expect(await run(signals, { now: new Date('2026-11-06T08:22:00Z') })).toBe(0); // antes das 08:23
    expect(await run(signals, { now: new Date('2026-11-07T08:35:00Z') })).toBe(0); // sábado
    expect(f.orders).toHaveLength(0);
    expect(await run(signals)).toBe(1);
    expect(f.orders).toHaveLength(1);
  });

  it('compra: limitada a último preço + 1 %, ordem do dia, não manual, com o orçamento', async () => {
    const f = use();
    await turnOn();
    await run({ 'a-momentum': [signal()] });
    expect(f.orders[0].body).toMatchObject({
      Uic: 23737, BuySell: 'Buy', OrderType: 'Limit', OrderPrice: 10.1, Amount: 1500, ManualOrder: false, OrderDuration: { DurationType: 'DayOrder' },
    });
    expect(f.orders[0].requestId).toBe(signalKey(signal(), 'a-momentum'));
    const [item] = await list();
    expect(item).toMatchObject({ outcome: 'sent', strategy: 'a-momentum', strategyName: 'A-Momentum', symbol: 'GALP.LS', order: { side: 'buy', orderType: 'limit', status: 'working', quantity: 1500 } });
  });

  it('corre de hora a hora: novos sinais da sessão em curso saem na hora seguinte, sem repetir os já enviados', async () => {
    const f = use();
    await turnOn();
    const today = signal({ date: '2026-11-06' });
    const lei = await makeInstrument(ctx.pool, 'NOVO.LS', { closes: ['20', '20'], sessions: [FINAL, '2026-11-06'] });
    await ctx.pool.query(
      "INSERT INTO saxo_instruments (instrument_id, environment, uic, saxo_symbol, exchange_id, currency, tradable, order_types, min_size, tick_scheme) VALUES (?, 'sim', 777, 'NOVO:xlis', 'LISB', 'EUR', 1, 'Market,Limit', 1, '{}')",
      [lei],
    );
    expect(await run({ 'a-momentum': [today] })).toBe(1);
    expect(f.orders).toHaveLength(1);
    expect(await run({ 'a-momentum': [today] })).toBe(0); // já correu nesta hora
    await ctx.pool.query("INSERT INTO job_runs (kind, status, started_at, finished_at) VALUES ('fetch_intraday', 'done', '2026-11-06 09:23:00', '2026-11-06 09:25:00')");
    const novo = signal({ date: '2026-11-06', instrumentId: lei, symbol: 'NOVO.LS', lastClose: '20' });
    expect(await run({ 'a-momentum': [today, novo] }, { now: new Date('2026-11-06T09:34:00Z') })).toBe(1);
    expect(f.orders).toHaveLength(2);
    expect(f.orders[1].body).toMatchObject({ Uic: 777, OrderPrice: 20.2, Amount: 750 });
    const { lastRun } = (await ana.get('/saxo/automation')).json();
    expect(lastRun).toMatchObject({ status: 'done', counts: { already: 1, sent: 1 } });
  });

  it('um sinal só se envia uma vez, mesmo noutro dia em que ainda seja elegível', async () => {
    const f = use();
    await turnOn();
    const signals = { 'a-momentum': [signal()] };
    await run(signals);
    await run(signals); // já correu hoje
    await ctx.pool.query('DELETE FROM saxo_automation_runs');
    await run(signals); // nova execução, mesmo sinal
    expect(f.orders).toHaveLength(1);
    expect(await list()).toHaveLength(1);
  });

  it('venda: a mercado, só do que a automação comprou para a estratégia e no máximo o que a conta tem', async () => {
    const f = use({ positions: [[23737, 800]] });
    await turnOn();
    await run({ 'a-momentum': [signal()] });
    await ctx.pool.query("UPDATE saxo_orders SET status = 'filled', filled_quantity = 1000, fill_price = 10");
    await ctx.pool.query('DELETE FROM saxo_automation_runs');
    await run({ 'a-momentum': [signal({ side: 'sell', reason: 'stop' })] });
    const sell = f.orders.at(-1).body;
    expect(sell).toMatchObject({ BuySell: 'Sell', OrderType: 'Market', Amount: 800, ManualOrder: false, OrderDuration: { DurationType: 'DayOrder' } });
    expect(sell.OrderPrice).toBeUndefined();
  });

  it('duas estratégias a vender o mesmo instrumento na mesma execução não vendem mais do que a conta tem', async () => {
    const f = use({ positions: [[23737, 1200]] });
    await turnOn('a-momentum');
    await turnOn('b-opus');
    await run({ 'a-momentum': [signal()], 'b-opus': [signal()] });
    await ctx.pool.query("UPDATE saxo_orders SET status = 'filled', filled_quantity = 1000, fill_price = 10");
    await ctx.pool.query('DELETE FROM saxo_automation_runs');
    await run({ 'a-momentum': [signal({ side: 'sell' })], 'b-opus': [signal({ side: 'sell' })] });
    const sells = f.orders.filter((o) => o.body.BuySell === 'Sell').map((o) => o.body.Amount);
    expect(sells).toEqual([1000, 200]);
  });

  it('uma venda ainda aberta conta como vendida: outro sinal de venda não vende de novo', async () => {
    const f = use({ positions: [[23737, 1000]] });
    await turnOn();
    await run({ 'a-momentum': [signal()] });
    await ctx.pool.query("UPDATE saxo_orders SET status = 'filled', filled_quantity = 1000, fill_price = 10");
    await ctx.pool.query('DELETE FROM saxo_automation_runs');
    await run({ 'a-momentum': [signal({ side: 'sell' })] });
    expect(f.orders.filter((o) => o.body.BuySell === 'Sell')).toHaveLength(1);
    await ctx.pool.query("UPDATE saxo_orders SET status = 'working' WHERE side = 'sell'");
    await ctx.pool.query('DELETE FROM saxo_automation_runs');
    await run({ 'a-momentum': [signal({ side: 'sell', date: '2026-11-06' })] });
    expect(f.orders.filter((o) => o.body.BuySell === 'Sell')).toHaveLength(1);
    expect((await list()).find((i) => i.signalDate === '2026-11-06')).toMatchObject({ outcome: 'skipped' });
  });

  it('venda sem posição da automação: não vende posições manuais nem as de outra estratégia', async () => {
    const f = use({ positions: [[23737, 500]] });
    await turnOn();
    await run({ 'a-momentum': [signal({ side: 'sell' })] });
    expect(f.orders).toHaveLength(0);
    const [item] = await list();
    expect(item).toMatchObject({ outcome: 'skipped', order: null });
    expect(item.message).toMatch(/sem posição/);
  });

  it('face ao BackTest: preço executado contra o do BackTest (fecho na A-Momentum, abertura nas outras) e ordens não executadas', async () => {
    await turnOn('a-momentum');
    await turnOn('b-opus');
    await run({ 'a-momentum': [signal()], 'b-opus': [signal({ price: '9.900000' })] });
    const setBy = (strategy, sql) => ctx.pool.query(`UPDATE saxo_orders o JOIN saxo_automation_orders a ON a.order_id = o.id SET ${sql} WHERE a.strategy_id = ?`, [strategy]);
    await setBy('a-momentum', "o.status = 'filled', o.filled_quantity = o.quantity, o.fill_price = 10.2");
    await setBy('b-opus', "o.status = 'expired'");
    const res = await ana.get('/saxo/automation/comparison');
    expect(res.statusCode).toBe(200);
    const { summary, items } = res.json();
    expect(summary).toMatchObject({ sent: 2, filled: 1, missed: 1, pending: 0, fillRatePct: 50, measured: 1, deviationPct: 2 });
    const a = items.find((i) => i.strategy === 'a-momentum');
    expect(a).toMatchObject({ execution: 'close', expectedPrice: 10, fillPrice: 10.2, state: 'filled', deviationPct: 2 });
    expect(a.effect).toBeCloseTo(0.2 * a.filledQuantity, 2);
    expect(summary.effect).toBeCloseTo(a.effect, 2);
    expect(items.find((i) => i.strategy === 'b-opus')).toMatchObject({ execution: 'open', expectedPrice: 9.9, state: 'missed', deviationPct: null });
    // A-Momentum com a sessão do sinal ainda provisória: o fecho do BackTest ainda não se conhece.
    await ctx.pool.query('UPDATE daily_quotes SET provisional = 1 WHERE session_date = ?', [FINAL]);
    expect((await ana.get('/saxo/automation/comparison')).json().items.find((i) => i.strategy === 'a-momentum').expectedPrice).toBeNull();
  });

  it('com as bolsas fechadas não envia: o sinal da tarde segue na execução das 08:33 da sessão seguinte', async () => {
    const f = use();
    await turnOn('c-ai');
    const friday = signal({ date: '2026-11-06' }); // visto na sexta à tarde, depois do fecho das 16:30
    await ctx.pool.query("INSERT INTO job_runs (kind, status, started_at, finished_at) VALUES ('fetch_intraday', 'done', '2026-11-06 16:23:00', '2026-11-06 16:28:00')");
    expect(await run({ 'c-ai': [friday] }, { now: new Date('2026-11-06T16:35:00Z') })).toBe(0);
    expect(f.orders).toHaveLength(0);
    // Segunda-feira: a recolha diária de sexta confirmou a sessão e a recolha das 08:23 já correu.
    await ctx.pool.query(
      `INSERT INTO job_runs (kind, status, started_at, finished_at) VALUES
       ('fetch_update', 'done', '2026-11-06 19:01:00', '2026-11-06 19:10:00'), ('fetch_intraday', 'done', '2026-11-09 08:23:00', '2026-11-09 08:28:00')`,
    );
    expect(await run({ 'c-ai': [friday] }, { now: new Date('2026-11-09T08:35:00Z') })).toBe(1);
    expect(f.orders).toHaveLength(1);
    expect(f.orders[0].body).toMatchObject({ BuySell: 'Buy', OrderType: 'Limit', OrderDuration: { DurationType: 'DayOrder' } });
  });

  it('compras só na lista e na melhor estratégia de cada instrumento; as vendas valem sempre', async () => {
    const f = use({ positions: [[23737, 800]] });
    await turnOn('c-ai');
    // C-AI não é a melhor estratégia da GALP (é a B-Opus): a compra fica de fora, sem ordem nem registo de falha.
    const notBest = buildEligibility({ mine: new Set([galp]), best: new Map([[galp, { strategyId: 'b-opus', total: 500 }]]) });
    await run({ 'c-ai': [signal()] }, { eligibility: async () => notBest });
    expect(f.orders).toHaveLength(0);
    expect(await list()).toHaveLength(0);
    // Fora da lista: também não.
    const notMine = buildEligibility({ mine: new Set(), best: new Map([[galp, { strategyId: 'c-ai', total: 500 }]]) });
    await ctx.pool.query('DELETE FROM saxo_automation_runs');
    await run({ 'c-ai': [signal()] }, { eligibility: async () => notMine });
    expect(f.orders).toHaveLength(0);
    // Na lista e com a C-AI como melhor: compra.
    const ok = buildEligibility({ mine: new Set([galp]), best: new Map([[galp, { strategyId: 'c-ai', total: 500 }]]) });
    await ctx.pool.query('DELETE FROM saxo_automation_runs');
    await run({ 'c-ai': [signal()] }, { eligibility: async () => ok });
    expect(f.orders).toHaveLength(1);
    // Depois de a GALP sair da lista, a venda da posição da automação continua a sair.
    await ctx.pool.query("UPDATE saxo_orders SET status = 'filled', filled_quantity = quantity, fill_price = 10");
    await ctx.pool.query('DELETE FROM saxo_automation_runs');
    await run({ 'c-ai': [signal({ side: 'sell', reason: 'stop', date: '2026-11-06' })] }, { eligibility: async () => notMine });
    expect(f.orders.filter((o) => o.body.BuySell === 'Sell')).toHaveLength(1);
  });

  it('elegibilidade: na lista, melhor estratégia do instrumento e resultado positivo', () => {
    const el = buildEligibility({
      mine: new Set([1, 2, 3]),
      best: new Map([[1, { strategyId: 'c-ai', total: 100 }], [2, { strategyId: 'c-ai', total: -50 }], [4, { strategyId: 'c-ai', total: 900 }]]),
    });
    expect(el('c-ai', 1)).toBe(true);
    expect(el('a-momentum', 1)).toBe(false); // outra estratégia
    expect(el('c-ai', 2)).toBe(false);       // «Nenhuma ganha»
    expect(el('c-ai', 3)).toBe(false);       // sem resultado
    expect(el('c-ai', 4)).toBe(false);       // fora da lista
  });

  it('recusa da SAXO fica registada com a ordem e não se repete', async () => {
    const f = use({ fail: () => json({ ErrorInfo: { Message: 'Saldo insuficiente' } }, 400) });
    await turnOn();
    const signals = { 'a-momentum': [signal()] };
    await run(signals);
    const [item] = await list();
    expect(item).toMatchObject({ outcome: 'sent', message: 'Saldo insuficiente', order: { status: 'rejected' } });
    await ctx.pool.query('DELETE FROM saxo_automation_runs');
    const g = use();
    await run(signals);
    expect(g.orders).toHaveLength(0);
    expect(f.orders).toHaveLength(0);
  });

  it('sem a recolha diária da última sessão não envia nada e diz porquê', async () => {
    const f = use();
    await turnOn();
    await ctx.pool.query("DELETE FROM job_runs WHERE kind = 'fetch_update'");
    await run({ 'a-momentum': [signal()] });
    expect(f.orders).toHaveLength(0);
    const { lastRun } = (await ana.get('/saxo/automation')).json();
    expect(lastRun).toMatchObject({ status: 'failed' });
    expect(lastRun.detail).toMatch(/recolha diária/);
  });

  it('espera pela recolha da hora; se não chegar, essa hora fica sem execução e diz porquê', async () => {
    const f = use();
    await turnOn();
    const signals = { 'a-momentum': [signal()] };
    const at = (m) => new Date(`2026-11-06T09:${m}:00Z`);
    expect(await run(signals, { now: at(30) })).toBe(0); // só há a recolha das 08:20 (a das 09:20 ainda não chegou)
    expect((await ana.get('/saxo/automation')).json().lastRun).toBeNull();
    expect(await run(signals, { now: at(37) })).toBe(0); // passou o minuto 35: a falta da recolha fica registada
    expect(f.orders).toHaveLength(0);
    const { lastRun } = (await ana.get('/saxo/automation')).json();
    expect(lastRun).toMatchObject({ status: 'failed' });
    expect(lastRun.detail).toMatch(/recolha horária/);
  });

  it('ligação à SAXO expirada: nada enviado, repete 5 min depois e envia então', async () => {
    await turnOn();
    await ctx.pool.query('UPDATE user_integration_tokens SET rejected_at = NOW(3)');
    const signals = { 'a-momentum': [signal()] };
    await run(signals);
    expect((await ana.get('/saxo/automation')).json().lastRun).toMatchObject({ status: 'failed' });
    expect(await list()).toHaveLength(0);
    await ctx.pool.query('UPDATE user_integration_tokens SET rejected_at = NULL');
    const f = use();
    expect(await run(signals, { now: new Date(NOW.getTime() + 60_000) })).toBe(0); // ainda não passaram 5 min
    await ctx.pool.query("UPDATE saxo_automation_runs SET finished_at = '2026-11-06 08:20:00'");
    expect(await run(signals)).toBe(1);
    expect(f.orders).toHaveLength(1);
  });

  it('conta real: a automação recusa, mesmo que a conta real seja activada', async () => {
    ctx.cfg.saxo.allowLive = true;
    try {
      const f = use();
      await turnOn();
      await ctx.pool.query("UPDATE user_integration_tokens SET environment = 'live'");
      await run({ 'a-momentum': [signal()] });
      expect(f.orders).toHaveLength(0);
      expect((await ana.get('/saxo/automation')).json().lastRun.detail).toMatch(/simulação/);
    } finally {
      ctx.cfg.saxo.allowLive = false;
    }
  });

  it('o envio pela API não aceita marcar uma ordem como automática', async () => {
    const f = use();
    const res = await ana.post('/saxo/orders', { instrumentId: galp, side: 'buy', quantity: 1, orderType: 'limit', limitPrice: '10', idempotencyKey: 'manual-aaaa-1', automated: true });
    expect(res.statusCode).toBe(201);
    expect(f.orders[0].body.ManualOrder).toBe(true);
  });
});
