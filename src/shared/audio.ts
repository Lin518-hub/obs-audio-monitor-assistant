export const MIN_DB = -100;

export function multiplierToDb(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return MIN_DB;
  }

  return Math.max(MIN_DB, 20 * Math.log10(multiplier));
}

export function maxInputLevelDb(levels: number[][]): number {
  // OBS reports [magnitude, peak, peak-hold] for each channel. Peak-hold is
  // intentionally excluded: it lingers after speech and would postpone the
  // start of silence detection even though the live signal has already ended.
  const livePeaks = levels
    .map((channel) => channel[1] ?? channel[0])
    .filter((value) => Number.isFinite(value));
  if (livePeaks.length === 0) {
    return MIN_DB;
  }

  return multiplierToDb(Math.max(...livePeaks));
}

export function isSilent(levelDb: number | null, thresholdDb: number): boolean {
  if (levelDb === null) {
    return false;
  }

  return levelDb <= thresholdDb;
}

export function smoothMeterLevel(previousDb: number | null, nextDb: number, elapsedMs: number): number {
  if (previousDb === null || !Number.isFinite(previousDb)) {
    return Math.max(MIN_DB, nextDb);
  }

  const safeElapsed = Math.max(1, Math.min(250, elapsedMs));
  const timeConstantMs = nextDb > previousDb ? 45 : 170;
  const alpha = 1 - Math.exp(-safeElapsed / timeConstantMs);
  return Math.max(MIN_DB, previousDb + (nextDb - previousDb) * alpha);
}
