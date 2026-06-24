import { describe, expect, it } from 'vitest';
import { maxInputLevelDb, multiplierToDb } from '../src/shared/audio.js';

describe('audio helpers', () => {
  it('converts OBS multipliers to dBFS', () => {
    expect(multiplierToDb(1)).toBeCloseTo(0);
    expect(multiplierToDb(0.5)).toBeCloseTo(-6.0206);
    expect(multiplierToDb(0)).toBe(-100);
  });

  it('reads the loudest channel from OBS meter data', () => {
    expect(maxInputLevelDb([[0.01, 0.2], [0.1]])).toBeCloseTo(-13.9794);
  });
});
