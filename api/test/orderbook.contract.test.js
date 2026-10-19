import { describe, expect, it } from 'vitest';
import { clearCache, fetchOrderBook } from '../src/orderbook/index.js';

// Teste de contrato com rede (especificação §10): só a forma da resposta, não os valores.
// Não corre no CI; para correr: EURONEXT_CONTRACT=1 npx vitest run test/orderbook.contract.test.js
describe.skipIf(process.env.EURONEXT_CONTRACT !== '1')('contrato do endpoint Euronext', () => {
  it('PTFCP0AM0008-XLIS devolve um livro com a forma esperada', async () => {
    clearCache();
    const book = await fetchOrderBook('PTFCP0AM0008', 'XLIS', { warn: () => {} });
    expect(book).toMatchObject({ isin: 'PTFCP0AM0008', mic: 'XLIS', delayMinutes: 15 });
    expect(Array.isArray(book.bids) && Array.isArray(book.asks)).toBe(true);
    for (const l of [...book.bids, ...book.asks]) {
      expect(typeof l.price).toBe('string');
      expect(Number.isInteger(l.quantity) && l.quantity > 0).toBe(true);
      expect(l.orders === null || Number.isInteger(l.orders)).toBe(true);
    }
    expect(book.updatedAt === null || book.updatedAt instanceof Date).toBe(true);
  }, 30_000);
});
