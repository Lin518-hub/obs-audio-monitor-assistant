import { expect, it } from 'vitest';
import { streamBitrateKbps } from '../src/shared/streamBitrate';
it('calculates kbps from stream bytes and milliseconds', () => {
  expect(streamBitrateKbps({bytes:1000,durationMs:1000},{bytes:1501000,durationMs:3000})).toBe(6000);
  expect(streamBitrateKbps({bytes:1000,durationMs:1000},{bytes:1000,durationMs:3000})).toBe(0);
});
it('waits for two samples and discards stream resets', () => {
  expect(streamBitrateKbps(null,{bytes:1000,durationMs:1000})).toBeNull();
  expect(streamBitrateKbps({bytes:1000,durationMs:1000},{bytes:0,durationMs:0})).toBeNull();
  expect(streamBitrateKbps({bytes:1000,durationMs:1000},{bytes:2000,durationMs:1000})).toBeNull();
});
