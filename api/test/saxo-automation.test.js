import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buyLimit, buyQuantity, lisbonClock, runDueAutomation, runSlot, selectSignals, signalKey } from '../src/saxo/automation.js';
import { encryptSecret } from '../src/secrets.js';
import { api, hasTestDb, login, makeInstrument, makeUser, setup, TEST_SECRET_KEY } from './helpers.js';

describe('automação: regras', () => {
  it('de hora a hora nos dias úteis, 10 minutos depois de cada recolha (08:23 a 17:23), com a hora de Verão', () => {
    expect(lisbonClock(new Date('2026-11-06T08:33:00Z'))).toEqual({ date: '2026-11-06', time: '08:33', weekday: 'Fri' });
    expect(lisbonClock(new Date('2026-07-06T07:33:00Z')).time).toBe('08:33'); // UTC+1
    expect(runSlot({ time: '08:32', weekday: 'Fri' })).toBeNull();
    expect(runSlot({ time: '08:33', weekday: 'Fri' })).toBe(8);
    expect(runSlot({ time: '08:52', weekday: 'Fri' })).toBe(8);
    expect(runSlot({ time: '08:53', weekday: 'Fri' })).toBeNull();
    expect(runSlot({ time: '17:33', weekday: 'Fri' })).toBe(17);
    expect(runSlot({ time: '07:40', weekday: 'Fri' })).toBeNull();
    expect(runSlot({ time: '18:33', weekday: 'Fri' })).toBeNull();
    expect(runSlot({ time: '08:33', weekday: 'Sat' })).toBeNull();
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
    if (p === '/port/v1/positions/me') return json({ Data: positions.map(([uic, amount]) => ({ PositionId: `P${uic}`, PositionBase: { Uic: uic, Amount: amount, AssetType: 'Stock', OpenPrice: 10, Status: 'Open' }, DisplayAndFormat: { Currency: 'EUR' } })) });
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
  const run = (signals, opts = {}) => runDueAutomation(ctx.pool, ctx.cfg, { now: NOW, loadSignals: async (st) => signals[st.id] ?? [], ...opts });
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
    expect(await run(signals, { now: new Date('2026-11-06T08:29:00Z') })).toBe(0);
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

  it('venda sem posição da automação: não vende posições manuais nem as de outra estratégia', async () => {
    const f = use({ positions: [[23737, 500]] });
    await turnOn();
    await run({ 'a-momentum': [signal({ side: 'sell' })] });
    expect(f.orders).toHaveLength(0);
    const [item] = await list();
    expect(item).toMatchObject({ outcome: 'skipped', order: null });
    expect(item.message).toMatch(/sem posição/);
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
    expect(await run(signals, { now: at(34) })).toBe(0); // só há a recolha das 08:23
    expect((await ana.get('/saxo/automation')).json().lastRun).toBeNull();
    expect(await run(signals, { now: at(50) })).toBe(0);
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
