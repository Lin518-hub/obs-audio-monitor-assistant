export const MIN_DB = -100;

export function multiplierToDb(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return MIN_DB;
  }

  return Math.max(MIN_DB, 20 * Math.log10(multiplier));
}

export function maxInputLevelDb(levels: number[][]): number {
  const flat = levels.flat().filter((value) => Number.isFinite(value));
  if (flat.length === 0) {
    return MIN_DB;
  }

  return multiplierToDb(Math.max(...flat));
}

export function isSilent(levelDb: number | null, thresholdDb: number): boolean {
  if (levelDb === null) {
    return false;
  }

  return levelDb <= thresholdDb;
}
