import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { abortable, nextTask } from './lifecycle.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('cooperative task scheduling', () => {
  it('prefers the scheduler, preserves its receiver and waits for its continuation', async () => {
    let resume!: () => void;
    const continuation = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const scheduler = {
      yield: vi.fn(function (this: unknown) {
        expect(this).toBe(scheduler);
        return continuation;
      }),
    };
    vi.stubGlobal('scheduler', scheduler);
    const channel = vi.spyOn(globalThis, 'MessageChannel');
    const timer = vi.spyOn(globalThis, 'setTimeout');
    let completed = false;
    const pending = nextTask().then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(scheduler.yield).toHaveBeenCalledTimes(1);
    expect(channel).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    resume();
    await pending;
    expect(completed).toBe(true);
  });

  it('propagates scheduler cancellation instead of rescheduling cancelled work', async () => {
    const reason = new DOMException('Task cancelled', 'AbortError');
    vi.stubGlobal('scheduler', { yield: () => Promise.reject(reason) });
    const channel = vi.spyOn(globalThis, 'MessageChannel');
    await expect(nextTask()).rejects.toBe(reason);
    expect(channel).not.toHaveBeenCalled();
  });

  it.each([undefined, {}])(
    'uses independent channel tasks without scheduler.yield (%j)',
    async (scheduler) => {
      vi.stubGlobal('scheduler', scheduler);
      const NativeChannel = globalThis.MessageChannel;
      const channels: MessageChannel[] = [];
      const closedPorts: MockInstance[] = [];
      vi.stubGlobal(
        'MessageChannel',
        class extends NativeChannel {
          constructor() {
            super();
            channels.push(this);
            closedPorts.push(vi.spyOn(this.port1, 'close'), vi.spyOn(this.port2, 'close'));
          }
        },
      );
      const timer = vi.spyOn(globalThis, 'setTimeout');
      const completed: number[] = [];
      const tasks = [0, 1, 2].map((index) =>
        nextTask().then(() => {
          completed.push(index);
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(completed).toEqual([]);
      await Promise.all(tasks);
      expect([...completed].sort((left, right) => left - right)).toEqual([0, 1, 2]);
      expect(channels).toHaveLength(3);
      for (const close of closedPorts) expect(close).toHaveBeenCalledTimes(1);
      for (const channel of channels) {
        expect(channel.port1.onmessage).toBeNull();
      }
      expect(timer).not.toHaveBeenCalled();
    },
  );

  it('uses a timer only when neither task API exists', async () => {
    vi.stubGlobal('scheduler', undefined);
    vi.stubGlobal('MessageChannel', undefined);
    vi.useFakeTimers();
    let completed = false;
    const pending = nextTask().then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    await vi.runAllTimersAsync();
    await pending;
    expect(completed).toBe(true);
  });
});

it('rejects promptly on abort and releases resources that resolve later', async () => {
  const controller = new AbortController();
  const released: number[] = [];
  let complete!: (value: number) => void;
  const result = abortable(
    new Promise<number>((resolve) => {
      complete = resolve;
    }),
    controller.signal,
    (value) => released.push(value),
  );
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(released).toEqual([]);
  complete(42);
  await Promise.resolve();
  expect(released).toEqual([42]);
});

it('does not dispose a resource already transferred to its caller', async () => {
  const controller = new AbortController();
  let released = false;
  expect(
    await abortable(Promise.resolve(42), controller.signal, () => {
      released = true;
    }),
  ).toBe(42);
  controller.abort();
  expect(released).toBe(false);
});
