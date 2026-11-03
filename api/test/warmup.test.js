import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleWarmups } from '../src/services/warmup.js';

const CHECK = 2 * 60_000;

function fakeApp() {
  const hooks = {};
  return { hooks, log: { warn: vi.fn() }, addHook: (name, fn) => { hooks[name] = fn; } };
}

describe('cálculo antecipado', () => {
  afterEach(() => vi.useRealTimers());

  it('corre no arranque e volta a correr quando a recolha termina', async () => {
    vi.useFakeTimers();
    let marker = 1;
    const pool = { query: async () => [[{ id: marker }]] };
    const app = fakeApp();
    const task = vi.fn(async () => {});
    scheduleWarmups(app, pool, [task]);
    await app.hooks.onReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);          // arranque
    await vi.advanceTimersByTimeAsync(CHECK);
    expect(task).toHaveBeenCalledTimes(1);          // nenhuma recolha nova
    marker = 2;
    await vi.advanceTimersByTimeAsync(CHECK);
    expect(task).toHaveBeenCalledTimes(2);          // recolha concluída: recalcula
    await app.hooks.onClose();
    marker = 3;
    await vi.advanceTimersByTimeAsync(CHECK);
    expect(task).toHaveBeenCalledTimes(2);          // depois de fechar a API, nada corre
  });

  it('uma tarefa que falha é registada e não impede as seguintes', async () => {
    vi.useFakeTimers();
    const app = fakeApp();
    const order = [];
    scheduleWarmups(app, { query: async () => [[{ id: null }]] }, [
      async () => { order.push('a'); throw new Error('falhou'); },
      async () => { order.push('b'); },
    ]);
    await app.hooks.onReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['a', 'b']);
    expect(app.log.warn).toHaveBeenCalledTimes(1);
    await app.hooks.onClose();
  });
});
