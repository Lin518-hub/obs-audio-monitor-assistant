import { beforeEach, describe, expect, it } from 'vitest';
import { clearRoundedWindowShapeCache, roundedWindowShape } from '../src/main/windowShape.js';

describe('roundedWindowShape', () => {
  beforeEach(() => clearRoundedWindowShapeCache());

  it('keeps the rounded scan-line union while merging adjacent rows', () => {
    const shape = roundedWindowShape(340, 178, 14);
    expect(shape[0]).toMatchObject({ y: 0, height: 1 });
    expect(shape.at(-1)).toMatchObject({ y: 177, height: 1 });
    expect(shape.some((rectangle) => rectangle.x === 0 && rectangle.height > 1)).toBe(true);
    expect(shape.reduce((height, rectangle) => height + rectangle.height, 0)).toBe(178);
    expect(shape.length).toBeLessThan(178);
  });

  it('reuses a settled size and separates different dimensions', () => {
    const first = roundedWindowShape(480, 252, 20);
    expect(roundedWindowShape(480, 252, 20)).toBe(first);
    expect(roundedWindowShape(481, 252, 20)).not.toBe(first);
  });

  it('clamps the radius to the available window size', () => {
    const shape = roundedWindowShape(10, 6, 100);
    expect(shape.reduce((height, rectangle) => height + rectangle.height, 0)).toBe(6);
    expect(shape.every((rectangle) => rectangle.x >= 0 && rectangle.width >= 0)).toBe(true);
  });
});
