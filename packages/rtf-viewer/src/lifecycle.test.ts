import { expect, it } from 'vitest';
import { abortable } from './lifecycle.js';

it('rejects promptly on abort and releases resources that resolve later', async () => {
  const controller = new AbortController();
  const released: number[] = [];
  let complete!: (value: number) => void;
  const result = abortable(new Promise<number>((resolve) => { complete = resolve; }), controller.signal, (value) => released.push(value));
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
  expect(await abortable(Promise.resolve(42), controller.signal, () => { released = true; })).toBe(42);
  controller.abort();
  expect(released).toBe(false);
});
