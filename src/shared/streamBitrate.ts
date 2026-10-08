export type StreamSample = { bytes: number; durationMs: number };
export function streamBitrateKbps(previous: StreamSample | null, current: StreamSample): number | null {
  if (!previous || !Number.isFinite(current.bytes) || !Number.isFinite(current.durationMs)
    || current.bytes < previous.bytes || current.durationMs <= previous.durationMs) return null;
  return (current.bytes - previous.bytes) * 8 / (current.durationMs - previous.durationMs);
}
