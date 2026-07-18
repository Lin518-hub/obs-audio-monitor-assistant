import type { PreflightRect, PreflightWindowPlacement, PreflightWindowState } from './types.js';

export interface PlacementDisplay {
  id: number;
  label: string;
  workArea: PreflightRect;
  primary: boolean;
}

export function captureWindowPlacement(
  bounds: PreflightRect,
  windowState: PreflightWindowState,
  displays: PlacementDisplay[],
  capturedAt = Date.now()
): PreflightWindowPlacement {
  const display = findOwningDisplay(bounds, displays) ?? fallbackDisplay(displays);
  const workArea = display?.workArea ?? { x: 0, y: 0, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };

  return {
    displayId: display?.id ?? null,
    displayLabel: display?.label ?? '',
    capturedWorkArea: { ...workArea },
    normalizedBounds: {
      x: (bounds.x - workArea.x) / Math.max(1, workArea.width),
      y: (bounds.y - workArea.y) / Math.max(1, workArea.height),
      width: bounds.width / Math.max(1, workArea.width),
      height: bounds.height / Math.max(1, workArea.height)
    },
    windowState,
    capturedAt
  };
}

export function resolveWindowPlacement(
  placement: PreflightWindowPlacement,
  displays: PlacementDisplay[],
  minimumSize: Pick<PreflightRect, 'width' | 'height'> = { width: 280, height: 180 }
): { bounds: PreflightRect; windowState: PreflightWindowState; displayId: number | null } {
  const display = findTargetDisplay(placement, displays) ?? fallbackDisplay(displays);
  const workArea = display?.workArea ?? placement.capturedWorkArea;
  const minimumWidth = Math.min(Math.max(1, minimumSize.width), Math.max(1, workArea.width));
  const minimumHeight = Math.min(Math.max(1, minimumSize.height), Math.max(1, workArea.height));
  const width = clamp(Math.round(workArea.width * finite(placement.normalizedBounds.width, .6)), minimumWidth, Math.max(minimumWidth, workArea.width));
  const height = clamp(Math.round(workArea.height * finite(placement.normalizedBounds.height, .6)), minimumHeight, Math.max(minimumHeight, workArea.height));
  const desiredX = Math.round(workArea.x + workArea.width * finite(placement.normalizedBounds.x, 0));
  const desiredY = Math.round(workArea.y + workArea.height * finite(placement.normalizedBounds.y, 0));

  return {
    bounds: {
      x: clamp(desiredX, workArea.x, workArea.x + Math.max(0, workArea.width - width)),
      y: clamp(desiredY, workArea.y, workArea.y + Math.max(0, workArea.height - height)),
      width,
      height
    },
    windowState: placement.windowState === 'maximized' ? 'maximized' : 'normal',
    displayId: display?.id ?? null
  };
}

function findOwningDisplay(bounds: PreflightRect, displays: PlacementDisplay[]): PlacementDisplay | null {
  let best: PlacementDisplay | null = null;
  let bestArea = -1;
  for (const display of displays) {
    const area = intersectionArea(bounds, display.workArea);
    if (area > bestArea) {
      best = display;
      bestArea = area;
    }
  }
  return bestArea > 0 ? best : null;
}

function findTargetDisplay(placement: PreflightWindowPlacement, displays: PlacementDisplay[]): PlacementDisplay | null {
  const exactGeometry = displays.find((display) => sameWorkArea(display.workArea, placement.capturedWorkArea));
  if (exactGeometry) return exactGeometry;

  const labelMatches = placement.displayLabel
    ? displays.filter((display) => display.label === placement.displayLabel)
    : [];
  if (labelMatches.length === 1) return labelMatches[0];

  const byId = placement.displayId === null ? null : displays.find((display) => display.id === placement.displayId);
  if (byId) {
    const closest = closestDisplay(placement.capturedWorkArea, displays);
    if (closest && workAreaDistance(placement.capturedWorkArea, closest.workArea) * 2 < workAreaDistance(placement.capturedWorkArea, byId.workArea)) {
      return closest;
    }
    return byId;
  }

  if (labelMatches.length > 1) return closestDisplay(placement.capturedWorkArea, labelMatches);
  if (displays.length > 1) return closestDisplay(placement.capturedWorkArea, displays);
  return null;
}

function sameWorkArea(a: PreflightRect, b: PreflightRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function closestDisplay(captured: PreflightRect, displays: PlacementDisplay[]): PlacementDisplay | null {
  return [...displays].sort((a, b) => workAreaDistance(captured, a.workArea) - workAreaDistance(captured, b.workArea))[0] ?? null;
}

function workAreaDistance(a: PreflightRect, b: PreflightRect): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
}

function fallbackDisplay(displays: PlacementDisplay[]): PlacementDisplay | null {
  return displays.find((display) => display.primary) ?? displays[0] ?? null;
}

function intersectionArea(a: PreflightRect, b: PreflightRect): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
