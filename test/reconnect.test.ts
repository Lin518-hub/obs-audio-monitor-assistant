import { describe, expect, it } from 'vitest';
import { reconnectBackoffDelay } from '../src/shared/reconnect.js';

describe('reconnectBackoffDelay', () => {
  it('backs off exponentially and caps the retry interval', () => {
    expect(reconnectBackoffDelay(1, 1_500, 30_000, 0, 0.5)).toBe(1_500);
    expect(reconnectBackoffDelay(2, 1_500, 30_000, 0, 0.5)).toBe(3_000);
    expect(reconnectBackoffDelay(3, 1_500, 30_000, 0, 0.5)).toBe(6_000);
    expect(reconnectBackoffDelay(20, 1_500, 30_000, 0, 0.5)).toBe(30_000);
  });

  it('never retries faster than the base interval when jitter is enabled', () => {
    expect(reconnectBackoffDelay(1, 1_500, 30_000, 0.15, 0)).toBe(1_500);
  });
});
