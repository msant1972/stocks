import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fillMissingIsinMics, readIsinFile, replaceEuronextIsins } from '../src/services/euronextIsins.js';
import { hasTestDb, makeInstrument, setup } from './helpers.js';

const ISIN_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ISIN.xlsx');

describe('lista oficial da Euronext (ISIN.xlsx)', () => {
  it('lê o ficheiro do repositório: todos os mercados conhecidos e ISIN válidos', async () => {
    const { rows, rejected } = await readIsinFile(ISIN_FILE);
    expect(rejected).toEqual([]);
    expect(rows.find((r) => r.yahooSymbol === 'GALP.LS')).toMatchObject({ isin: 'PTGAL0AM0009', mic: 'XLIS', symbol: 'GALP' });
  });
});

describe.skipIf(!hasTestDb)('preenchimento do ISIN-MIC a partir de euronext_isins', () => {
  let ctx;
  beforeAll(async () => { ctx = await setup(); });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.pool.end();
  });

  it('carrega a tabela e preenche só os instrumentos sem ISIN-MIC que constam da lista', async () => {
    const galp = await makeInstrument(ctx.pool, 'GALP.LS');
    await makeInstrument(ctx.pool, 'SAP.DE');
    const asml = await makeInstrument(ctx.pool, 'ASML.AS');
    await ctx.pool.query("UPDATE instruments SET isin = 'NL0010273215', mic = 'XAMS' WHERE id = ?", [asml]);
    await replaceEuronextIsins(ctx.pool, (await readIsinFile(ISIN_FILE)).rows);

    expect(await fillMissingIsinMics(ctx.pool, { apply: false })).toEqual([{ id: Number(galp), symbol: 'GALP.LS', isinMic: 'PTGAL0AM0009-XLIS', name: expect.any(String) }]);
    await fillMissingIsinMics(ctx.pool);
    const [[g]] = await ctx.pool.query('SELECT isin, mic FROM instruments WHERE id = ?', [galp]);
    expect(g).toEqual({ isin: 'PTGAL0AM0009', mic: 'XLIS' });
    expect(await fillMissingIsinMics(ctx.pool)).toEqual([]);
  });
});
