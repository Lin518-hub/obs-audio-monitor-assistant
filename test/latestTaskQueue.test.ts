import { describe, expect, it, vi } from 'vitest';
import { LatestTaskQueue } from '../src/shared/latestTaskQueue.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('LatestTaskQueue', () => {
  it('reuses the active task within the same generation', async () => {
    const queue = new LatestTaskQueue<string>();
    const pending = deferred<string>();
    const task = vi.fn(() => pending.promise);

    const first = queue.run(task);
    const second = queue.run(task);
    pending.resolve('done');

    await expect(first).resolves.toBe('done');
    await expect(second).resolves.toBe('done');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid invalidations and runs only the latest queued task', async () => {
    const queue = new LatestTaskQueue<string>();
    const pending = deferred<string>();
    const firstTask = vi.fn(() => pending.promise);
    const staleTask = vi.fn(async () => 'stale');
    const latestTask = vi.fn(async (generation: number) => `latest-${generation}`);

    const first = queue.run(firstTask);
    queue.invalidate();
    const queued = queue.run(staleTask);
    queue.invalidate();
    const latest = queue.run(latestTask);
    pending.resolve('first');

    await expect(first).resolves.toBe('first');
    await expect(queued).resolves.toBe('latest-2');
    await expect(latest).resolves.toBe('latest-2');
    expect(staleTask).not.toHaveBeenCalled();
    expect(latestTask).toHaveBeenCalledTimes(1);
  });

  it('continues with the latest generation after the active task rejects', async () => {
    const queue = new LatestTaskQueue<string>();
    const pending = deferred<string>();
    const first = queue.run(() => pending.promise);
    queue.invalidate();
    const latest = queue.run(async () => 'recovered');
    pending.reject(new Error('old source failed'));

    await expect(first).rejects.toThrow('old source failed');
    await expect(latest).resolves.toBe('recovered');
  });

  it('queues another latest task when the source changes during a queued run', async () => {
    const queue = new LatestTaskQueue<string>();
    const firstPending = deferred<string>();
    const secondPending = deferred<string>();

    const first = queue.run(() => firstPending.promise);
    queue.invalidate();
    const second = queue.run(() => secondPending.promise);
    firstPending.resolve('first');
    await first;
    await Promise.resolve();

    queue.invalidate();
    const third = queue.run(async (generation) => `third-${generation}`);
    secondPending.resolve('second');

    await expect(second).resolves.toBe('second');
    await expect(third).resolves.toBe('third-2');
  });
});
