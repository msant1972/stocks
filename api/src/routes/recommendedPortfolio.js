import { z } from 'zod';
import { DEFAULT_OPTIONS } from '../../../shared/strategies/portfolio.js';
import { ErrorBody, IsoDate } from '../schemas.js';
import { recommendedPortfolioService, WINDOW_MONTHS } from '../services/recommendedPortfolio.js';

const N = z.number();
const Item = z.object({
  instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), sector: z.string().nullable(),
  rank: z.number().nullable().describe('Lugar no ranking da última revisão (null: já não era elegível)'),
  score: N.nullable().describe('Pontuação das Promessas na última revisão, de 0 a 100'),
  close: N.nullable().describe('Último fecho'),
  weight: N.nullable().describe('Peso na carteira (fracção); numa compra ainda por executar, o peso-alvo'),
  buyDate: IsoDate.nullable(), pnlPct: N.nullable().describe('Resultado desde a entrada, em %, com dividendos e custos'),
  inWatchlist: z.boolean(),
});
const SellItem = Item.omit({ weight: true }).extend({
  reason: z.enum(['ranking', 'filtro']).describe('ranking: saiu dos melhores e há substituto; filtro: perdeu a tendência ou a liquidez'),
  sellDate: IsoDate.nullable(),
});
const Period = z.object({ value: N, benchmark: N.nullable() }).nullable();

const emptyBody = () => ({
  latestSession: null, firstDate: null, lastDate: null, universe: 0, windowMonths: WINDOW_MONTHS,
  options: pickOptions(DEFAULT_OPTIONS),
  summary: {
    returnPct: 0, benchmarkPct: null, annualPct: 0, last12: null, last6: null, last3: null, maxDrawdownPct: 0, benchmarkDrawdownPct: null,
    reviews: 0, closed: 0, wins: 0, tradesPerReview: 0, avgPositions: 0, invested: 0, benchmarkInstruments: 0, feesPct: 0,
  },
  curve: [], review: { date: null, executed: false, executionDate: null, next: null, eligible: 0, buy: [], keep: [], sell: [] },
  positions: [], reviews: [], trades: [],
});
const pickOptions = ({ positions, keepRank, weeks, maxPerSector, minTradedValue, capital }) => ({ positions, keepRank, weeks, maxPerSector, minTradedValue, capital });

/** Semana (segunda-feira) de uma data, para reduzir a curva a uma leitura por semana. */
function weekOf(date) {
  const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  return Math.floor((t / 86_400_000 + 3) / 7);
}

/**
 * Portfolio Recomendado (docs/arquitectura/Portfolio-Recomendado.md): carteira-modelo de 20 instrumentos, revista de duas em duas
 * semanas, com as listas a comprar, a manter e a vender e o rendimento dos últimos 24 meses. Não envia ordens.
 */
export default async function recommendedPortfolioRoutes(app, { pool, warmup = () => {} }) {
  const svc = recommendedPortfolioService(pool);
  warmup(() => svc.refresh()); // no arranque e depois de cada recolha

  app.get('/recommended-portfolio', {
    schema: {
      tags: ['Estratégia'], summary: 'Portfolio Recomendado: carteira-modelo de 20 instrumentos, revista de duas em duas semanas',
      description: 'Na primeira sessão de cada bloco de duas semanas (decisão ao fecho, execução na abertura seguinte) ordena o catálogo pela '
        + 'pontuação das Promessas, só entre os instrumentos com a tendência intacta e liquidez mínima. Mantém as posições que continuam '
        + 'entre os `keepRank` melhores, vende as outras e compra os mais bem classificados até ter `positions`, no máximo `maxPerSector` '
        + 'por sector. `review` é a última revisão (o que comprar, manter e vender); `curve` e `summary` medem a carteira nos últimos 24 '
        + 'meses, em base 100, com dividendos e custos estimados da SAXO, contra todo o catálogo em partes iguais (`benchmark`). '
        + 'Só usa sessões fechadas. Simulação sobre dados passados: não é aconselhamento de investimento.',
      response: {
        200: z.object({
          latestSession: IsoDate.nullable(), firstDate: IsoDate.nullable(), lastDate: IsoDate.nullable(), universe: z.number(), windowMonths: z.number(),
          options: z.object({ positions: z.number(), keepRank: z.number(), weeks: z.number(), maxPerSector: z.number(), minTradedValue: z.number(), capital: z.number() }),
          summary: z.object({
            returnPct: N, benchmarkPct: N.nullable(), annualPct: N, last12: Period, last6: Period, last3: Period,
            maxDrawdownPct: N, benchmarkDrawdownPct: N.nullable(), reviews: z.number(), closed: z.number(), wins: z.number(),
            tradesPerReview: N, avgPositions: N, invested: N.describe('Parte da carteira investida (o resto é numerário)'),
            benchmarkInstruments: z.number(), feesPct: N.describe('Custos pagos na janela, em % do valor inicial'),
          }),
          curve: z.array(z.object({ date: IsoDate, value: N, benchmark: N.nullable() })),
          review: z.object({
            date: IsoDate.nullable(), executed: z.boolean().describe('false: decidida ao último fecho, a executar na abertura seguinte'),
            executionDate: IsoDate.nullable(), next: IsoDate.nullable().describe('Segunda-feira da semana da revisão seguinte'),
            eligible: z.number(), buy: z.array(Item), keep: z.array(Item), sell: z.array(SellItem),
          }),
          positions: z.array(Item),
          reviews: z.array(z.object({ date: IsoDate, eligible: z.number(), bought: z.array(z.string()), sold: z.array(z.string()), kept: z.number() })),
          trades: z.array(z.object({
            instrumentId: z.number(), symbol: z.string(), name: z.string().nullable(), buyDate: IsoDate, sellDate: IsoDate,
            reason: z.enum(['ranking', 'filtro']), pnlPct: N,
          })),
        }),
        401: ErrorBody,
      },
    },
  }, async (req) => {
    const r = await svc.run();
    if (!r || !r.firstDate) return emptyBody();
    const [w] = await pool.query('SELECT instrument_id FROM watchlist_items WHERE user_id = ?', [req.user.id]);
    const mine = new Set(w.map((x) => Number(x.instrument_id)));
    const item = (x) => ({
      instrumentId: x.instrumentId, symbol: x.symbol, name: x.name, sector: x.sector, rank: x.rank, score: x.score, close: x.close ?? null,
      weight: x.weight ?? null, buyDate: x.buyDate ?? null, pnlPct: x.pnlPct ?? null, inWatchlist: mine.has(x.instrumentId),
    });
    const sellItem = (x) => { const { weight, ...rest } = item(x); return { ...rest, reason: x.reason, sellDate: x.sellDate ?? null }; };
    // A curva traz o ponto de partida (base 100) e uma sessão por semana (a última de cada semana): ~105 pontos em 24 meses.
    const curve = r.curve.filter((c, i, a) => i === 0 || i === a.length - 1 || weekOf(c.date) !== weekOf(a[i + 1].date))
      .map(({ date, value, benchmark }) => ({ date, value, benchmark }));
    return {
      latestSession: r.latestSession, firstDate: r.firstDate, lastDate: r.lastDate, universe: r.universe, windowMonths: WINDOW_MONTHS,
      options: pickOptions(r.options), summary: r.summary, curve,
      review: { ...r.review, buy: r.review.buy.map(item), keep: r.review.keep.map(item), sell: r.review.sell.map(sellItem) },
      positions: r.positions.map(item),
      reviews: r.reviews.slice(0, 12),
      trades: r.trades.slice(0, 100).map(({ instrumentId, symbol, name, buyDate, sellDate, reason, pnlPct }) => ({ instrumentId, symbol, name, buyDate, sellDate, reason, pnlPct })),
    };
  });
}
