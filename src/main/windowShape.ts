export interface WindowShapeRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_CACHE_ENTRIES = 24;
const shapeCache = new Map<string, WindowShapeRectangle[]>();

/**
 * Returns the exact scan-line union for a rounded rectangle while merging
 * adjacent equal-width rows. The bounded cache avoids recalculating the same
 * native window shape after resize settle and app restart restoration.
 */
export function roundedWindowShape(width: number, height: number, radius: number): WindowShapeRectangle[] {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const safeRadius = Math.min(
    Math.max(0, Math.round(radius)),
    Math.floor(safeWidth / 2),
    Math.floor(safeHeight / 2)
  );
  const key = `${safeWidth}:${safeHeight}:${safeRadius}`;
  const cached = shapeCache.get(key);
  if (cached) {
    shapeCache.delete(key);
    shapeCache.set(key, cached);
    return cached;
  }

  const rectangles: WindowShapeRectangle[] = [];
  for (let y = 0; y < safeHeight; y += 1) {
    const distanceFromTop = y < safeRadius
      ? safeRadius - y
      : y >= safeHeight - safeRadius
        ? y - (safeHeight - safeRadius - 1)
        : 0;
    const inset = distanceFromTop <= 0
      ? 0
      : Math.ceil(safeRadius - Math.sqrt(Math.max(0, safeRadius * safeRadius - distanceFromTop * distanceFromTop)));
    const rowWidth = Math.max(0, safeWidth - inset * 2);
    const previous = rectangles.at(-1);

    if (previous && previous.x === inset && previous.width === rowWidth && previous.y + previous.height === y) {
      previous.height += 1;
    } else {
      rectangles.push({ x: inset, y, width: rowWidth, height: 1 });
    }
  }

  shapeCache.set(key, rectangles);
  if (shapeCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = shapeCache.keys().next().value;
    if (oldestKey !== undefined) shapeCache.delete(oldestKey);
  }
  return rectangles;
}

export function clearRoundedWindowShapeCache(): void {
  shapeCache.clear();
}
