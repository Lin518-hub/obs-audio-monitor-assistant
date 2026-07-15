export function reconnectBackoffDelay(
  attempt: number,
  baseMs = 1_500,
  maxMs = 30_000,
  jitterRatio = 0.15,
  randomValue = Math.random()
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(maxMs, baseMs * 2 ** (safeAttempt - 1));
  const jitter = exponential * Math.max(0, jitterRatio) * ((Math.max(0, Math.min(1, randomValue)) * 2) - 1);
  return Math.max(baseMs, Math.round(Math.min(maxMs, exponential + jitter)));
}
