import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Os testes partilham a base de dados stocks_test, por isso correm em série.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
