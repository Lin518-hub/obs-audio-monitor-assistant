export interface FloatingBounds { x: number; y: number; width: number; height: number }

/** Resize in desktop DIP coordinates, keeping the opposite edge anchored. */
export function resizeFloatingBounds(
  bounds: FloatingBounds,
  delta: { x: number; y: number },
  edge: string,
  ratio: number,
  minimum: number[],
  maximum: number[]
): FloatingBounds {
  const change = edge === 'n' || edge === 's'
    ? delta.y * (edge === 'n' ? -1 : 1) * ratio
    : delta.x * (edge.includes('w') ? -1 : 1);
  const lower = Math.max(minimum[0], minimum[1] * ratio);
  const upper = Math.min(maximum[0], maximum[1] * ratio);
  const width = Math.round(Math.max(lower, Math.min(upper, bounds.width + change)));
  const height = Math.round(width / ratio);
  return {
    x: edge.includes('w') ? bounds.x + bounds.width - width : bounds.x,
    y: edge.includes('n') ? bounds.y + bounds.height - height : bounds.y,
    width, height
  };
}
