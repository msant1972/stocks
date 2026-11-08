import { expect, test } from '@playwright/test';
import { totp } from '../../api/src/auth/totp.js';

/**
 * A aplicação inteira no navegador, depois de a carteira virtual ser retirada: a carteira é a conta de simulação da SAXO
 * (aqui uma SAXO falsa, ver server.mjs). Os testes partilham o estado e correm por ordem.
 */
const EMAIL = 'e2e@exemplo.pt';
// Os mesmos de api/test/helpers.js (o servidor cria o utilizador com eles); importar esse ficheiro aqui carregaria a API.
const PASSWORD = 'palavra-passe-de-teste';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const money = (s) => new RegExp(s.replace(/ /g, '\\s?')); // pt-PT: sem separador de milhares nos números de 4 algarismos
let page;
const errors = [];

/** Erros de JavaScript e erros na consola (os pedidos recusados de propósito, 4xx, não contam). */
function watch(p) {
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
}
const saxo = async () => (await page.request.get('/__saxo')).json();
const nav = (name) => page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name, exact: true });

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  watch(page);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(async () => {
  expect(errors, 'erros de JavaScript na página').toEqual([]);
});

test('entra com palavra-passe e código de 6 dígitos', async () => {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Palavra-passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByLabel('Código de 6 dígitos').fill(totp(TOTP_SECRET));
  await page.getByRole('button', { name: /Confirmar|Entrar|Verificar/ }).click();
  await expect(page.getByRole('heading', { name: 'Valor da carteira' })).toBeVisible();
});

test('Visão geral: o valor da carteira é o da conta SAXO, com saldo, custo, resultado e evolução', async () => {
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Valor da carteira' }) });
  const s = await saxo();
  const pos = s.positions[0];
  await expect(card.getByText('Saldo disponível')).toBeVisible();
  await expect(card).toContainText(money('298 500,00 €'));
  await expect(card).toContainText(money('1 400,00 €')); // custo: 100 × 14
  await expect(card).toContainText(/Face ao capital inicial de 1\s000\s000,00\s€/);
  await expect(card).toContainText(/Desde /); // mini-evolução com as leituras guardadas
  await expect(card.getByRole('img', { name: /Evolução do valor da carteira/ })).toBeVisible();
  expect(pos.amount).toBe(100);
  await expect(card.getByRole('link', { name: 'Ver carteira' })).toHaveAttribute('href', '/saxo/carteira');
  await expect(card).not.toContainText(/virtual/i);
});

test('menu: sem Carteira nem Operações; Alertas no Mercado; grupo Administração', async () => {
  const menu = page.getByRole('navigation', { name: 'Principal' });
  await expect(menu.getByRole('link', { name: 'Carteira', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: 'Operações', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: 'Carteira SAXO' })).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Mercado' }).getByRole('link', { name: 'Alertas', exact: true })).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Administração' })).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Carteira' })).toHaveCount(0);
});

test('endereços antigos: /carteira abre a Carteira SAXO e /operacoes as Ordens SAXO', async () => {
  await page.goto('/carteira');
  await expect(page).toHaveURL(/\/saxo\/carteira$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Carteira SAXO' })).toBeVisible();
  await page.goto('/operacoes');
  await expect(page).toHaveURL(/\/saxo\/ordens$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Ordens SAXO' })).toBeVisible();
});

test('Carteira SAXO: valor, custo, gráfico da evolução e posições, sem a comparação com a carteira virtual', async () => {
  await page.goto('/saxo/carteira');
  await expect(page.getByText('Montante investido (custo)')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evolução da carteira' })).toBeVisible();
  await expect(page.locator('.chart-box .recharts-surface').first()).toBeVisible();
  await expect(page.getByLabel('Tabela de posições SAXO')).toContainText('GALP.LS');
  await expect(page.getByText(/carteira virtual/i)).toHaveCount(0);
});

test('Charts: lista «Saxo» só com as posições; a ordem à SAXO é a acção principal e actualiza a carteira', async () => {
  await page.goto('/charts?fonte=saxo');
  const list = page.getByRole('list', { name: /Instrumentos \(Saxo/ });
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list).toContainText('GALP.LS');
  await expect(page.getByRole('button', { name: 'Simular operação' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Lista' }).getByRole('button')).toHaveText(['Lista', 'Saxo', 'Catálogo']);

  await page.getByRole('button', { name: /Enviar à SAXO/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Quantidade (unidades)').fill('10');
  await dialog.getByRole('button', { name: /Confirmar e enviar compra/ }).click();
  await expect(dialog.getByText('Número na SAXO')).toBeVisible();
  const s = await saxo();
  expect(s.orders.at(-1)).toMatchObject({ BuySell: 'Buy', Amount: 10, OrderType: 'Limit', ManualOrder: true });
  await dialog.getByRole('button', { name: 'Concluir' }).click();

  // Sem recarregar a página: a Visão geral já mostra o saldo depois da compra.
  await nav('Visão geral').click();
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Valor da carteira' }) });
  const cash = s.cash.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, ' ');
  await expect(card).toContainText(money(`${cash} €`));
});

test('Sinais: «Vender na SAXO» usa as unidades da conta SAXO; «Comprar na SAXO» o orçamento da estratégia', async () => {
  // Os sinais dependem das estratégias sobre os dados: aqui fixam-se dois, um de venda e um de compra.
  await page.route('**/api/v1/signals?**', async (route) => {
    const base = { name: null, reason: null, sessionsAgo: 0, price: '15', lastClose: '15', changeSincePct: '0.00', momentumPct: '1.00' };
    const today = new Date().toISOString().slice(0, 10);
    const instruments = await (await page.request.get('/api/v1/watchlist')).json();
    const id = (sym) => instruments.items.find((i) => i.symbol === sym).id;
    await route.fulfill({ json: { strategy: 'a-momentum', sessions: 5, latestSession: today, items: [
      { ...base, instrumentId: id('GALP.LS'), symbol: 'GALP.LS', side: 'sell', date: today, lastDate: today },
      { ...base, instrumentId: id('BCP.LS'), symbol: 'BCP.LS', side: 'buy', date: today, lastDate: today, lastClose: '0.8', price: '0.8' },
    ] } });
  });
  await page.goto('/sinais');
  await expect(page.getByRole('button', { name: /^Comprar(?! na SAXO)/ })).toHaveCount(0);
  const before = await saxo();
  const held = before.positions.find((p) => p.uic === 23737).amount;
  const sell = page.getByRole('button', { name: 'Vender na SAXO GALP.LS' });
  await expect(sell).toBeEnabled();
  await sell.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Quantidade (unidades)')).toHaveValue(String(held));
  await dialog.getByRole('button', { name: /Confirmar e enviar venda/ }).click();
  await expect(dialog.getByText('Número na SAXO')).toBeVisible();
  expect((await saxo()).orders.at(-1)).toMatchObject({ BuySell: 'Sell', Amount: held });
  await dialog.getByRole('button', { name: 'Concluir' }).click();
  // A conta já não tem GALP: o botão fica inactivo sem recarregar.
  await expect(sell).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Comprar na SAXO BCP.LS' })).toBeEnabled();
  await page.unroute('**/api/v1/signals?**');
});

test('Timelapse: anima o top sessão a sessão, nos três universos', async () => {
  await page.goto('/timelapse');
  await expect(page.getByRole('heading', { level: 1, name: 'Timelapse' })).toBeVisible();
  const status = page.getByText(/^Sessão \d+ de 22:/);
  await expect(status).toContainText('Sessão 1 de 22');
  await expect(page.locator('.timelapse-row:not(.is-out)')).toHaveCount(2); // o catálogo de teste tem 2 instrumentos
  await expect(status).toContainText('Sessão 2 de 22', { timeout: 4000 }); // 2 s por sessão
  await page.getByRole('button', { name: 'Pausa' }).click();
  await page.getByRole('button', { name: 'Última sessão' }).click();
  await expect(status).toContainText('Sessão 22 de 22');
  await page.getByRole('button', { name: 'Primeira sessão' }).click();
  await expect(status).toContainText('Sessão 1 de 22');
  await page.getByRole('group', { name: 'Universo' }).getByRole('button', { name: 'Saxo' }).click();
  await expect(page).toHaveURL(/universo=saxo/);
  // O teste dos Sinais vendeu todas as GALP: a conta SAXO de teste fica sem posições.
  await expect(page.getByText('A conta SAXO não tem posições de instrumentos do catálogo.')).toBeVisible();
  await page.getByRole('group', { name: 'Universo' }).getByRole('button', { name: 'A minha lista' }).click();
  await expect(page.locator('.timelapse-row:not(.is-out)')).toHaveCount(2);
  // Cor pela variação do preço (verde, cinzento, vermelho), com legenda; clicar numa barra destaca-a; 5 sessões por omissão.
  await expect(page.getByRole('heading', { name: 'Top 30 · valor negociado de 5 sessões' })).toBeVisible();
  const tones = await page.locator('.timelapse-row:not(.is-out) .timelapse-bar').evaluateAll((els) => els.map((el) => el.dataset.tone));
  expect(tones.every((t) => /^(up|down)-[123]$|^flat$/.test(t))).toBe(true);
  await expect(page.getByLabel(/Cor: variação do preço nas 5 sessões/)).toContainText('±2 %');
  await expect(page.locator('.timelapse-row:not(.is-out) .timelapse-value').first()).toContainText(/%/);
  await page.locator('.timelapse-row:not(.is-out)').first().click();
  await expect(page.locator('.timelapse-row.is-focus')).toHaveCount(1);
  await expect(page.getByText(/^Sessão \d+ de 22:/)).toContainText('A seguir');
  await page.getByLabel('Sessões somadas').selectOption('1');
  await expect(page).toHaveURL(/sessoes=1/);
  await expect(page.getByRole('heading', { name: 'Top 30 · valor negociado da sessão' })).toBeVisible();
  await expect(page.locator('.timelapse-row.is-focus')).toHaveCount(0); // dados novos: larga o destaque
  await page.getByText('Ver os dados desta sessão').click();
  await expect(page.locator('details').getByRole('table')).toContainText('GALP.LS');
  // Duplo clique numa barra abre esse instrumento no Charts, com a lista do universo escolhido.
  const first = page.locator('.timelapse-row:not(.is-out)').first();
  const symbol = (await first.locator('.timelapse-label').innerText()).replace(/^\d+\.\s*/, '');
  await first.dblclick();
  await expect(page).toHaveURL(/\/charts\?instrumento=\d+&fonte=lista/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(symbol);
});

test('Laboratório: experiências já feitas, registar uma nova e mudar o estado sem perder o resto', async () => {
  await page.goto('/laboratorio');
  await expect(page.getByRole('heading', { level: 1, name: 'Laboratório' })).toBeVisible();
  await expect(page.locator('.lab-card')).toHaveCount(11);
  await page.getByRole('button', { name: 'Nova experiência' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Título').fill('Stops mais largos na C-AI');
  await dialog.getByLabel('Hipótese').fill('Menos vendas por ruído');
  await dialog.getByRole('button', { name: 'Registar' }).click();
  const card = page.locator('.lab-card', { hasText: 'Stops mais largos na C-AI' });
  await expect(card).toContainText('Ideia');
  await card.getByRole('button', { name: /Editar/ }).click();
  await dialog.getByLabel('Estado').selectOption('dropped');
  await dialog.getByLabel('Resultado').fill('Não melhorou');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(card).toContainText('Abandonada');
  await expect(card).toContainText('Menos vendas por ruído'); // a hipótese fica
  await expect(card).toContainText(/decidida a/);
  await page.getByRole('group', { name: 'Estado' }).getByRole('button', { name: /Abandonada/ }).click();
  await expect(page.locator('.lab-card')).toHaveCount(5);
});

test('Comparar: custos e período de verificação, e a classificação nas quatro condições', async () => {
  await page.goto('/comparar?custos=1');
  await expect(page.getByText(/depois dos custos estimados da SAXO/)).toBeVisible();
  await expect(page.getByText(/Custos estimados: comissão de 0,08 %/)).toBeVisible();
  await page.getByRole('group', { name: 'Período' }).getByRole('button', { name: 'Verificação' }).click();
  await expect(page).toHaveURL(/periodo=verificacao/);
  await expect(page.getByRole('heading', { name: 'A classificação aguenta?' })).toBeVisible();
  await expect(page.getByLabel('Posição das estratégias em cada condição')).toContainText('C-AI', { timeout: 30_000 });
});

test('todas as páginas abrem sem erros', async () => {
  const pages = [
    ['/', 'Visão geral'], ['/acompanhar', null], ['/charts', null], ['/orderbook', null], ['/heatmap', null], ['/timelapse', 'Timelapse'], ['/alertas', 'Alertas'],
    ['/saxo/carteira', 'Carteira SAXO'], ['/saxo/ordens', 'Ordens SAXO'], ['/saxo/alertas', null], ['/saxo/automacao', 'Automação'],
    ['/sinais', null], ['/backtest', null], ['/comparar', null], ['/winners-loosers', null], ['/promessas', null], ['/pechinchas', 'Pechinchas'],
    ['/calor', 'Calor'], ['/utilizadores', null], ['/saxo/correspondencia', 'Correspondência SAXO'], ['/definicoes', 'Definições'],
  ];
  for (const [url, title] of pages) {
    await page.goto(url);
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1, url).toBeVisible();
    if (title && title !== 'Visão geral') await expect(h1, url).toHaveText(title);
    await expect(page.locator('body'), url).not.toContainText(/carteira virtual/i);
    await expect(page.locator('body'), url).not.toContainText(/\bNaN\b|\bundefined\b/); // «Finance» contém «nan»: distinguir maiúsculas
  }
  await page.goto('/definicoes');
  await expect(page.getByRole('heading', { name: 'Regras das ordens' })).toBeVisible();
  await page.goto('/utilizadores');
  await expect(page.getByText(/Capital virtual/)).toHaveCount(0);
});

test('telemóvel: a barra inferior tem a Carteira SAXO', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() });
  const m = await ctx.newPage();
  watch(m);
  await m.goto('/');
  const bar = m.getByRole('navigation', { name: 'Principal' });
  await expect(bar.getByRole('link', { name: 'Carteira SAXO' })).toBeVisible();
  await bar.getByRole('link', { name: 'Carteira SAXO' }).click();
  await expect(m).toHaveURL(/\/saxo\/carteira$/);
  await ctx.close();
});
