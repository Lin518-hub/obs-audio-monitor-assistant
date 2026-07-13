import { describe, expect, it } from 'vitest';
import { maxInputLevelDb, multiplierToDb, smoothMeterLevel } from '../src/shared/audio.js';

describe('audio helpers', () => {
  it('converts OBS multipliers to dBFS', () => {
    expect(multiplierToDb(1)).toBeCloseTo(0);
    expect(multiplierToDb(0.5)).toBeCloseTo(-6.0206);
    expect(multiplierToDb(0)).toBe(-100);
  });

  it('reads the loudest channel from OBS meter data', () => {
    expect(maxInputLevelDb([[0.01, 0.2], [0.1]])).toBeCloseTo(-13.9794);
  });

  it('ignores the OBS peak-hold value when the live signal has fallen', () => {
    expect(maxInputLevelDb([[0.01, 0.02, 0.8], [0.005, 0.01, 0.6]])).toBeCloseTo(-33.9794);
  });

  it('reacts faster to speech than it falls back to the noise floor', () => {
    const attack = smoothMeterLevel(-70, -20, 50);
    const release = smoothMeterLevel(-20, -70, 50);

    expect(attack).toBeGreaterThan(-40);
    expect(release).toBeGreaterThan(-35);
  });

  it('never returns a level below the supported meter floor', () => {
    expect(smoothMeterLevel(-95, -200, 250)).toBe(-100);
  });
});
