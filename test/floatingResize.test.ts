import { describe, expect, it } from 'vitest';
import { resizeFloatingBounds } from '../src/shared/floatingResize';

const bounds = { x: -800, y: 120, width: 340, height: 178 };
const resize = (edge: string, x: number, y: number) =>
  resizeFloatingBounds(bounds, { x, y }, edge, 340 / 178, [280, 147], [680, 356]);

describe('floating resize in desktop coordinates', () => {
  it('updates before release and preserves the fixed ratio', () => {
    const first = resize('se', 30, 10);
    const next = resize('se', 60, 20);
    expect(first.width).toBe(370);
    expect(next.width).toBe(400);
    expect(next.height).toBe(Math.round(400 * 178 / 340));
    expect(next.x).toBe(bounds.x);
  });
  it('anchors opposite edges on negative-coordinate displays', () => {
    for (const edge of ['w', 'nw', 'sw']) {
      const result = resize(edge, -60, 0);
      expect(result.x + result.width).toBe(bounds.x + bounds.width);
    }
    for (const edge of ['n', 'nw', 'ne']) {
      const result = resize(edge, 60, -40);
      expect(result.y + result.height).toBe(bounds.y + bounds.height);
    }
  });
  it('supports vertical edge drags and clamps both size limits', () => {
    expect(resize('s', 0, 89).width).toBe(510);
    expect(resize('e', 9999, 0).width).toBe(680);
    expect(resize('e', -9999, 0).height).toBeGreaterThanOrEqual(147);
  });
});
