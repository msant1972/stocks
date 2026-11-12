import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadSnapshot, saveSnapshot } from '../src/services/strategyResults.js';

describe('resultados das estratégias gravados em disco', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-snap-'));
  const file = path.join(dir, 'sub', 'strategy-results.json');
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('sem ficheiro configurado ou inexistente: cache vazia', () => {
    expect(loadSnapshot(null).size).toBe(0);
    expect(loadSnapshot(file).size).toBe(0);
  });

  it('grava e volta a ler, com as entradas marcadas como antigas (recalculam-se)', async () => {
    const cache = new Map([['a-momentum', { at: Date.now(), items: [{ instrumentId: 1, total: 10 }] }], ['verification:c-ai', { at: 0, items: [] }]]);
    await saveSnapshot(file, cache);
    const back = loadSnapshot(file);
    expect([...back.keys()]).toEqual(['a-momentum', 'verification:c-ai']);
    expect(back.get('a-momentum')).toEqual({ at: 0, items: [{ instrumentId: 1, total: 10 }] });
    expect(fs.readdirSync(path.dirname(file))).toEqual(['strategy-results.json']); // sem ficheiro temporário
  });

  it('ignora ficheiros estragados, de outra versão ou antigos', () => {
    fs.writeFileSync(file, '{ meio escrito');
    expect(loadSnapshot(file).size).toBe(0);
    fs.writeFileSync(file, JSON.stringify({ version: 99, savedAt: Date.now(), entries: { x: [] } }));
    expect(loadSnapshot(file).size).toBe(0);
    fs.writeFileSync(file, JSON.stringify({ version: 1, savedAt: Date.now() - 8 * 86_400_000, entries: { x: [] } }));
    expect(loadSnapshot(file).size).toBe(0);
  });

  it('erro a gravar não rebenta (só regista)', async () => {
    const warns = [];
    const notDir = path.join(dir, 'ficheiro');
    fs.writeFileSync(notDir, 'x'); // uma pasta que é um ficheiro: mkdir falha (ENOTDIR/EEXIST)
    await saveSnapshot(path.join(notDir, 'aqui.json'), new Map(), { warn: (o) => warns.push(o) });
    expect(warns).toHaveLength(1);
  });
});
