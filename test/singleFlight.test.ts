import { describe, it, expect, vi } from 'vitest';
import { SingleFlight } from '../src/shared/singleFlight';
describe('one-click preparation coalescing', () => {
  it('shares concurrent requests without launching another operation', async () => {
    const flight = new SingleFlight<number>();
    const action = vi.fn(async () => 7);
    const first = flight.run(action), second = flight.run(action);
    expect(first).toBe(second);
    expect(await second).toBe(7); expect(action).toHaveBeenCalledOnce();
    await flight.run(action); expect(action).toHaveBeenCalledTimes(2);
  });
  it('clears failed operations so corrected settings can be retried', async () => {
    const flight = new SingleFlight<number>();
    await expect(flight.run(() => { throw new Error('failure'); })).rejects.toThrow('failure');
    await expect(flight.run(async () => 1)).resolves.toBe(1);
  });
});
