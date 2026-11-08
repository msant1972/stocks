/**
 * Custos de negociação estimados para o modo «com custos» do BackTest e do Comparar (conta SAXO, nível Classic).
 *
 * As estratégias simulam sem custos; aqui calculam-se depois, a partir das ordens que cada simulação fez (cada lote
 * comprado e cada venda), sem mudar as decisões da estratégia:
 *  - comissão por ordem: commissionPct do valor, com o mínimo commissionMin (SAXO Classic: 0,08 %, mínimo de 2 € na
 *    Euronext e 3 € ou mais noutras bolsas; usa-se 3 € para não subestimar);
 *  - spread: metade de spreadPct em cada ordem (diferença entre o preço de compra e de venda no mercado);
 *  - custódia: custodyPctYear ao ano sobre o valor investido (o custo de compra), pelo tempo com posição.
 * A posição aberta no fim conta como vendida ao último preço (com a comissão e o spread dessa venda), para comparar
 * com as operações fechadas e com comprar e manter. Estimativa: confirmar na tabela de preços da SAXO.
 */
export const DEFAULT_COSTS = Object.freeze({ commissionPct: 0.08, commissionMin: 3, spreadPct: 0.1, custodyPctYear: 0.15 });

const DAY_MS = 86_400_000;
const round2 = (x) => Math.round(x * 100) / 100;
const days = (from, to) => Math.max(0, (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Comissão e meio spread de uma ordem de `amount` euros. */
export function orderCost(amount, model = DEFAULT_COSTS) {
  const a = Number(amount);
  if (!(a > 0)) return 0;
  return Math.max((a * model.commissionPct) / 100, model.commissionMin) + (a * model.spreadPct) / 200;
}

/** Custódia de `amount` euros investidos entre duas datas (AAAA-MM-DD). */
export function custodyCost(amount, from, to, model = DEFAULT_COSTS) {
  return (Number(amount) * model.custodyPctYear * days(from, to)) / 100 / 365;
}

/**
 * Custos de um resultado do registo das estratégias (trades, open). mid: data que separa o 1.º do 2.º ano da janela
 * (como o resultado por ano: uma operação conta no ano em que foi vendida; a posição aberta, no 2.º); lastDate: última
 * sessão da janela. Devolve { total, firstYear, secondYear, orders, winsNet } (winsNet: operações fechadas com ganho
 * depois dos custos).
 */
export function strategyCosts(r, { mid, lastDate, model = DEFAULT_COSTS }) {
  let firstYear = 0;
  let secondYear = 0;
  let orders = 0;
  let winsNet = 0;
  for (const t of r.trades ?? []) {
    let c = orderCost(t.proceeds, model);
    orders += 1;
    for (const lot of t.lots ?? []) {
      c += orderCost(lot.cost, model) + custodyCost(lot.cost, lot.date, t.sellDate, model);
      orders += 1;
    }
    if (t.sellDate < mid) firstYear += c; else secondYear += c;
    if (t.pnl - c > 0) winsNet += 1;
  }
  if (r.open) {
    let c = orderCost(r.open.value, model);
    for (const lot of r.open.lots ?? []) {
      c += orderCost(lot.cost, model) + custodyCost(lot.cost, lot.date, r.open.lastDate ?? lastDate, model);
      orders += 1;
    }
    secondYear += c;
  }
  const [y1, y2] = [round2(firstYear), round2(secondYear)];
  return { total: round2(y1 + y2), firstYear: y1, secondYear: y2, orders, winsNet }; // total = soma das partes mostradas
}

/** Custos de comprar e manter: uma compra no início, a venda ao último preço e a custódia entre as duas. */
export function buyHoldCosts(bh, lastDate, model = DEFAULT_COSTS) {
  if (!bh) return null;
  return round2(orderCost(bh.cost, model) + orderCost(bh.value, model) + custodyCost(bh.cost, bh.startDate, lastDate, model));
}

/** Texto do modelo para a interface. */
export function describeCosts(model = DEFAULT_COSTS) {
  const pt = (x) => String(x).replace('.', ',');
  return `comissão de ${pt(model.commissionPct)} % por ordem (mínimo ${model.commissionMin} €), spread de ${pt(model.spreadPct)} % `
    + `(metade em cada ordem) e custódia de ${pt(model.custodyPctYear)} % ao ano sobre o valor investido`;
}
