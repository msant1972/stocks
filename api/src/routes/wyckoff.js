import { z } from 'zod';
import { PHASES } from '../../../shared/wyckoff.js';
import { ErrorBody, IsoDate } from '../schemas.js';
import { wyckoffService } from '../services/wyckoff.js';

const Phase = z.enum(PHASES);

/**
 * Fases de Wyckoff (docs/arquitectura/Wyckoff.md): em que fase do ciclo está cada instrumento — acumulação, subida,
 * distribuição, queda ou indefinida. Etiqueta descritiva para o Acompanhar, o Charts, as Promessas e o HeatMap.
 */
export default async function wyckoffRoutes(app, { pool, warmup = () => {} }) {
  const svc = wyckoffService(pool);
  warmup(() => svc.refresh()); // no arranque e depois de cada recolha

  app.get('/wyckoff', {
    schema: {
      tags: ['Estratégia'], summary: 'Fase de Wyckoff de cada instrumento, na última sessão fechada',
      description: 'accumulation: faixa lateral estreita no terço inferior do intervalo de 52 semanas, depois de uma queda de 20 % ou mais; '
        + 'distribution: faixa lateral no terço superior, depois de uma subida de 25 % ou mais; markup: fora de uma faixa, com o fecho '
        + 'acima da SMA50, a SMA50 a subir e 3 meses positivos; markdown: o inverso; undefined: o resto. `support` e `resistance` são os '
        + 'limites da faixa das últimas 40 sessões (fecho mais baixo e mais alto, a preços de hoje); `rangeSessions` há quantas sessões o '
        + 'fecho anda dentro dela (só em faixa lateral); `volumeBias` de que lado esteve o volume (−1 a 1). Descritivo: não é uma previsão.',
      response: {
        200: z.object({
          computedAt: z.string().nullable(), latestSession: IsoDate.nullable(),
          counts: z.object(Object.fromEntries(PHASES.map((p) => [p, z.number()]))),
          items: z.array(z.object({
            instrumentId: z.number(), phase: Phase, date: IsoDate, lateral: z.boolean(),
            position: z.number().describe('Lugar da faixa no intervalo de 52 semanas: 0 no mínimo, 1 no máximo'),
            width: z.number().describe('Largura da faixa das últimas 40 sessões (fracção)'),
            support: z.number(), resistance: z.number(), rangeSessions: z.number().nullable(), volumeBias: z.number(),
          })),
        }),
        401: ErrorBody,
      },
    },
  }, async () => svc.run());
}
