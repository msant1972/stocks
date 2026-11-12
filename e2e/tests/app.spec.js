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

test('Charts: eixo dos valores à direita, cruz no cursor e medida ao arrastar (desaparece ao largar)', async () => {
  await page.goto('/charts');
  const price = page.locator('.chart-pane-price');
  await expect(price).toBeVisible();
  // Eixo à direita: os valores ficam na metade direita do painel.
  const axis = price.locator('svg text').filter({ hasText: /^\d+,\d\d$/ }).first(); // um valor do eixo (ex.: «3,32»)
  await expect(axis).toBeVisible();
  const [t, box0] = await Promise.all([axis.boundingBox(), price.boundingBox()]);
  let box = box0;
  expect(t.x).toBeGreaterThan(box0.x + box0.width * 0.8);
  // Cruz: cursor em cruz e linha horizontal que acompanha o rato.
  expect(await price.evaluate((el) => getComputedStyle(el).cursor)).toBe('crosshair');
  let y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.4, y);
  const hline = price.locator('.chart-hline');
  await expect(hline).toBeVisible();
  // RSI14: painel entre o volume e o momento (com o botão para o esconder).
  const rsiBox = await page.locator('.chart-pane-rsi').boundingBox();
  const volBox = await page.locator('.chart-pane-volume').boundingBox();
  const momBox = await page.locator('.chart-pane-momentum').boundingBox();
  expect(volBox.y).toBeLessThan(rsiBox.y);
  expect(rsiBox.y).toBeLessThan(momBox.y);
  await page.getByRole('button', { name: 'RSI14' }).click();
  await expect(page.locator('.chart-pane-rsi')).toHaveCount(0);
  await page.getByRole('button', { name: 'RSI14' }).click();
  await expect(page.locator('.chart-pane-rsi')).toBeVisible();
  await page.waitForTimeout(300); // o gráfico reajusta a altura dos painéis
  box = await price.boundingBox();
  // Medir: carregar, arrastar e largar.
  y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 8 });
  await expect(price.getByText(/\d+ sessões · \d+ dias · [+−]\d+,\d\d %/)).toBeVisible();
  await page.screenshot({ path: process.env.E2E_SHOT_MEASURE || '/tmp/e2e-medida.png' });
  await page.mouse.up();
  await expect(price.getByText(/sessões · .* dias/)).toHaveCount(0);
});

test('Charts: cartões «Estratégia» e «Empresa» a pedido, com os interruptores guardados', async () => {
  const strategyCard = () => page.locator('section.charts-strategy');
  const companyCard = () => page.locator('section.charts-company');
  await page.goto('/charts');
  await expect(page.locator('.chart-pane-price')).toBeVisible();
  // Por omissão a informação extra não se pede nem se mostra (página mais leve).
  await expect(strategyCard()).toHaveCount(0);
  await expect(companyCard()).toHaveCount(0);
  const profiles = [];
  page.on('request', (r) => { if (/\/profile$/.test(r.url())) profiles.push(r.url()); });
  await page.getByLabel('Mostrar a informação da estratégia').evaluate((el) => el.click());
  await expect(strategyCard()).toBeVisible();
  await expect(strategyCard().getByRole('heading', { name: 'Estratégia', level: 2 })).toBeVisible();
  await expect(strategyCard()).toContainText('simulação no histórico'); // a melhor estratégia do BCP.LS está seleccionada
  expect(profiles).toHaveLength(0); // a empresa continua por pedir
  await page.getByLabel('Mostrar a informação da empresa').evaluate((el) => el.click());
  await expect(companyCard()).toBeVisible();
  // O estado fica guardado.
  await page.reload();
  await expect(page.getByLabel('Mostrar a informação da estratégia')).toBeChecked();
  await expect(page.getByLabel('Mostrar a informação da empresa')).toBeChecked();
  await expect(strategyCard()).toBeVisible();
  // Desligar tira o cartão.
  await page.getByLabel('Mostrar a informação da estratégia').evaluate((el) => el.click());
  await page.getByLabel('Mostrar a informação da empresa').evaluate((el) => el.click());
  await expect(strategyCard()).toHaveCount(0);
  await expect(companyCard()).toHaveCount(0);
});

test('Calor: os cartões por esta ordem, Capitalização Mercado, Valor negociado diário e Valor mensal negociado', async () => {
  await page.goto('/calor');
  await expect(page.getByRole('heading', { level: 1, name: 'Calor' })).toBeVisible();
  const titles = page.locator('main section.card h2.card-title');
  await expect(titles.first()).toBeVisible();
  const all = await titles.allInnerTexts();
  const pos = (re) => all.findIndex((t) => re.test(t));
  expect(pos(/Capitalização Mercado/)).toBe(0);
  expect(pos(/Valor negociado diário/)).toBeGreaterThan(pos(/Capitalização Mercado/));
  const monthly = pos(/Valor mensal negociado/);
  if (monthly >= 0) expect(monthly).toBeGreaterThan(pos(/Valor negociado diário/)); // só aparece com meses completos
});

test('Carteira SAXO: «Vender Tudo» abre o diálogo de emergência com as posições, antes de vender (aqui só se cancela)', async () => {
  await page.goto('/saxo/carteira');
  const sellAll = page.getByRole('button', { name: 'Vender Tudo' });
  await expect(sellAll).toBeEnabled();
  // Ao lado esquerdo de «Actualizar», no canto superior direito.
  const [a, b] = await Promise.all([sellAll.boundingBox(), page.getByRole('button', { name: 'Actualizar' }).boundingBox()]);
  expect(a.x + a.width).toBeLessThanOrEqual(b.x);
  await sellAll.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Emergência');
  await expect(dialog).toContainText('uma a cada 6 segundos');
  await expect(dialog.getByRole('table', { name: 'Vendas a enviar' }).or(dialog.getByLabel('Vendas a enviar'))).toContainText('GALP.LS');
  await expect(dialog.getByLabel(/Desligar também a Automação/)).toBeChecked();
  await expect(dialog.getByRole('button', { name: /Vender tudo \(1 instrumento\)/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  expect((await saxo()).positions.find((p) => p.uic === 23737).amount).toBeGreaterThan(0); // nada foi vendido
});

test('Charts: botão «Posições» marca com um X verde a compra das posições da conta SAXO', async () => {
  await page.goto('/charts');
  await page.getByRole('button', { name: 'GALP.LS' }).first().click(); // a GALP tem uma posição na conta SAXO de teste
  const marker = page.locator('.chart-pane-price title', { hasText: /Posição na SAXO: 100 unidades a 14,00/ });
  await expect(page.getByRole('heading', { name: 'GALP.LS', level: 1 })).toBeVisible();
  const chip = page.getByRole('button', { name: 'Posições' });
  await expect(chip).toBeVisible();
  if ((await chip.getAttribute('aria-pressed')) === 'true') await chip.click(); // começa desligado
  await expect(marker).toHaveCount(0);
  await chip.click();
  await expect(marker).toHaveCount(1);
  await page.reload(); // o estado do botão fica guardado
  await expect(page.getByRole('button', { name: 'Posições' })).toHaveAttribute('aria-pressed', 'true');
  await expect(marker).toHaveCount(1);
  // A BCP não tem posição: sem marcador.
  await page.getByRole('button', { name: 'BCP.LS' }).first().click();
  await expect(page.getByRole('heading', { name: 'BCP.LS', level: 1 })).toBeVisible();
  await expect(page.locator('.chart-pane-price title', { hasText: 'Posição na SAXO' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Posições' }).click();
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
    ['/calor', 'Calor'], ['/utilizadores', null], ['/definicoes', 'Definições'],
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

test('WinnersLoosers: cartão dos resultados mistos e remoção em bloco da minha lista (perdedores e mistos)', async () => {
  await page.goto('/winners-loosers');
  const mixed = page.locator('section', { has: page.getByRole('heading', { name: 'Resultados mistos' }) });
  await expect(mixed).toBeVisible();
  const rows = await mixed.locator('tbody tr').count();
  expect(rows).toBeGreaterThan(0); // os dados de teste (GALP e BCP) têm resultados mistos
  // Perdedores: o botão está sempre visível; sem nenhum na lista, desactivado.
  const loss = page.locator('section', { has: page.getByRole('heading', { name: 'Perdem com todas as estratégias' }) });
  await expect(loss.getByRole('button', { name: /Remover da lista \(0\)/ })).toBeDisabled();
  // Mistos: remove em bloco os que estão na lista.
  await mixed.getByRole('button', { name: new RegExp(`Remover da lista \\(${rows}\\)`) }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('resultados mistos');
  await dialog.getByRole('button', { name: `Remover ${rows}` }).click();
  await expect(mixed.getByRole('button', { name: /Remover da lista \(0\)/ })).toBeDisabled();
  const list = await (await page.request.get('/api/v1/watchlist')).json();
  expect(list.items).toHaveLength(0);
});

test('Definições: Correspondência SAXO e Cópias de segurança são cartões; a página e o menu antigos desapareceram', async () => {
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Correspondência SAXO' })).toHaveCount(0);
  await page.goto('/saxo/correspondencia');
  await expect(page).toHaveURL(/\/definicoes#correspondencia-saxo$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Definições' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Correspondência SAXO', level: 2 })).toBeVisible();
  const backup = page.locator('section', { has: page.getByRole('heading', { name: 'Cópias de segurança' }) });
  await expect(backup).toContainText('Base de dados');
  await expect(backup).toContainText('Restaurar: não há botão');
});

test('Definições → Estratégias: desligar uma estratégia tira-a de todos os módulos, e ligar volta a pô-la', async () => {
  const strategySwitch = (name) => page.getByLabel(`Estratégia ${name}`);
  await page.goto('/definicoes');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Estratégias', exact: true }) });
  await expect(card).toBeVisible();
  await strategySwitch('B-Opus').evaluate((el) => el.click());
  await expect(page.getByText('B-Opus desligada')).toBeVisible();
  const options = async (url) => {
    await page.goto(url);
    const menu = page.getByRole('combobox', { name: 'Estratégia' });
    await menu.waitFor();
    return menu.locator('option').allInnerTexts();
  };
  expect(await options('/backtest')).toEqual(['A-Momentum', 'C-AI', 'D-Reversão', 'E-Ondas']);
  expect(await options('/sinais')).toEqual(['A-Momentum', 'C-AI', 'D-Reversão', 'E-Ondas']);
  await page.goto('/comparar');
  await expect(page.getByRole('link', { name: 'C-AI' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'B-Opus' })).toHaveCount(0);
  await page.goto('/winners-loosers');
  await expect(page.getByRole('columnheader', { name: /C-AI/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /B-Opus/ })).toHaveCount(0);
  // Automação: a estratégia desligada nas Definições aparece marcada e não se liga.
  await page.goto('/saxo/automacao');
  await expect(page.getByText('desligada nas Definições')).toBeVisible();
  await expect(page.getByLabel('Automação da estratégia B-Opus')).toBeDisabled();
  // Tem de ficar pelo menos uma: com só a E-Ondas ligada, o interruptor dela fica bloqueado.
  await page.goto('/definicoes');
  for (const name of ['A-Momentum', 'C-AI', 'D-Reversão']) {
    await strategySwitch(name).evaluate((el) => el.click());
    await expect(page.getByText(`${name} desligada`)).toBeVisible(); // espera pelo fim de cada pedido
  }
  await expect(strategySwitch('E-Ondas')).toBeDisabled();
  for (const name of ['A-Momentum', 'B-Opus', 'C-AI', 'D-Reversão']) {
    await strategySwitch(name).evaluate((el) => el.click());
    await expect(page.getByText(`${name} ligada`)).toBeVisible();
  }
  await expect(strategySwitch('B-Opus')).toBeChecked();
  expect(await options('/backtest')).toEqual(['A-Momentum', 'B-Opus', 'C-AI', 'D-Reversão', 'E-Ondas']);
});

test('Utilizadores: fotografia na barra lateral e «Terminar sessão» com o botão direito', async () => {
  await page.goto('/utilizadores');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNQaDiAFTEMLQkAOsZYAYJCUNYAAAAASUVORK5CYII=', 'base64');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'eu.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText(/Fotografia de .* actualizada/)).toBeVisible();
  const side = page.getByRole('navigation', { name: 'Principal' }).first();
  await expect(side.locator('.avatar img')).toBeVisible();
  await expect(side.locator('.avatar img')).toHaveJSProperty('complete', true);
  // O menu abre com o botão direito e fecha com Esc, sem terminar a sessão.
  await side.locator('.avatar-button').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Terminar sessão' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Terminar sessão' })).toHaveCount(0);
  await page.getByRole('button', { name: /Remover fotografia/ }).click();
  await expect(page.getByText(/Fotografia de .* removida/)).toBeVisible();
  await expect(side.locator('.avatar img')).toHaveCount(0);
});

test('Definições → Logotipos: Client ID da Brandfetch (CDN simulado)', async () => {
  // O CDN da Brandfetch é simulado: os testes não saem para a Internet. O pedido tem de levar a origem (Referer).
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNQaDiAFTEMLQkAOsZYAYJCUNYAAAAASUVORK5CYII=', 'base64');
  const referers = [];
  await page.route('https://cdn.brandfetch.io/**', (route) => {
    referers.push(route.request().headers().referer ?? '');
    return route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });
  await page.goto('/definicoes');
  const card = page.getByRole('region', { name: 'Logotipos' });
  await expect(card.getByText('Sem Client ID: sem logotipos')).toBeVisible();
  await card.getByLabel('Client ID').fill('x'.repeat(80));
  await expect(card.getByText(/parece a API key secreta/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  await card.getByLabel('Client ID').fill('idTeste_123');
  await card.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Client ID da Brandfetch guardado')).toBeVisible();
  await expect(card.getByText('Configurado')).toBeVisible();
  await expect(card.getByRole('img', { name: /Logotipo de exemplo/ })).toHaveJSProperty('complete', true);
  expect(referers.at(-1)).toMatch(/^http:\/\/[^/]+\/$/); // só a origem
  await card.getByRole('button', { name: 'Apagar' }).click();
  await expect(card.getByText('Sem Client ID: sem logotipos')).toBeVisible();
  await page.unroute('https://cdn.brandfetch.io/**');
});
