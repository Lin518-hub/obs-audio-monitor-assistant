import { describe, expect, it } from 'vitest';
import { ATEM_MORANDI_COLORS, defaultATEMInputColor } from '../src/shared/atemPalette.js';

describe('ATEM Morandi palette', () => {
  it('assigns stable, distinct default colors to adjacent camera inputs', () => {
    const cameraColors = Array.from({ length: 8 }, (_, index) => defaultATEMInputColor(index + 1));
    expect(new Set(cameraColors).size).toBe(8);
    expect(cameraColors.every((color) => ATEM_MORANDI_COLORS.includes(color as typeof ATEM_MORANDI_COLORS[number]))).toBe(true);
    expect(defaultATEMInputColor(1)).toBe(cameraColors[0]);
  });

  it('wraps safely for ATEM auxiliary source identifiers', () => {
    expect(defaultATEMInputColor(1001)).toMatch(/^#[0-9A-F]{6}$/);
    expect(defaultATEMInputColor(Number.NaN)).toBe(ATEM_MORANDI_COLORS[0]);
  });
});
