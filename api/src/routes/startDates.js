import { z } from 'zod';
import { AppError } from '../errors.js';
import { ErrorBody, IsoDate } from '../schemas.js';
import { recommendedPortfolioService } from '../services/recommendedPortfolio.js';
import { rotationService } from '../services/rotation.js';

const MODULES = ['recommended-portfolio', 'rotation'];

/**
 * Data de início das carteiras simuladas, por utilizador e módulo (tabela portfolio_start_dates): o Portfolio Recomendado e a
 * Rotação começam vazios nesse dia. Fica gravada até ser alterada; null grava a escolha do período do módulo (sem data). Sem
 * linha, a interface usa a data por omissão (1 jan. 2026).
 */
export default async function startDateRoutes(app, { pool }) {
  const limitsOf = {
    'recommended-portfolio': () => recommendedPortfolioService(pool).limits(),
    rotation: () => rotationService(pool).limits(), // a janela de 12 meses é a que pede mais histórico
  };

  app.get('/portfolio-start-dates', {
    schema: {
      tags: ['Estratégia'], summary: 'Datas de início gravadas pelo utilizador (Portfolio Recomendado e Rotação)',
      response: { 200: z.object({ items: z.array(z.object({ module: z.enum(MODULES), start: IsoDate.nullable().describe('null: o período do módulo') })) }) },
    },
  }, async (req) => {
    const [rows] = await pool.query('SELECT module, start_date FROM portfolio_start_dates WHERE user_id = ? ORDER BY module', [req.user.id]);
    return { items: rows.filter((r) => MODULES.includes(r.module)).map((r) => ({ module: r.module, start: r.start_date })) };
  });

  app.put('/portfolio-start-dates/:module', {
    schema: {
      tags: ['Estratégia'], summary: 'Gravar a data de início de um módulo (null: usar o período do módulo, sem data)',
      params: z.object({ module: z.enum(MODULES) }),
      body: z.object({ start: IsoDate.nullable() }),
      response: { 204: z.null(), 400: ErrorBody },
    },
  }, async (req, reply) => {
    const { module } = req.params;
    const { start } = req.body;
    const { minStart, latestSession } = start === null ? {} : await limitsOf[module]();
    if (start !== null && (!minStart || start < minStart || start >= latestSession)) {
      throw new AppError(400, 'START_OUT_OF_RANGE', !minStart ? 'ainda não há histórico suficiente para escolher uma data de início' : `a data de início tem de estar entre ${minStart} e a véspera da última sessão (${latestSession})`, { minStart, latestSession });
    }
    await pool.query(
      `INSERT INTO portfolio_start_dates (user_id, module, start_date) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE start_date = VALUES(start_date)`,
      [req.user.id, module, start],
    );
    return reply.code(204).send(null);
  });
}
