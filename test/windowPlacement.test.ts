import { describe, expect, it } from 'vitest';
import { parseWindowsWindowList } from '../src/main/windowsWindowManager.js';
import { captureWindowPlacement, resolveWindowPlacement, type PlacementDisplay } from '../src/shared/windowPlacement.js';

const displays: PlacementDisplay[] = [
  { id: 1, label: 'Primary', workArea: { x: 0, y: 0, width: 1920, height: 1040 }, primary: true },
  { id: 2, label: 'Side', workArea: { x: 1920, y: 0, width: 1280, height: 1024 }, primary: false }
];

describe('preflight window placement', () => {
  it('captures normalized coordinates on the display containing the window', () => {
    const placement = captureWindowPlacement({ x: 2048, y: 102, width: 640, height: 512 }, 'normal', displays, 10);
    expect(placement.displayId).toBe(2);
    expect(placement.normalizedBounds).toEqual({ x: .1, y: 102 / 1024, width: .5, height: .5 });
    expect(placement.capturedAt).toBe(10);
  });

  it('scales the saved layout to a changed display work area', () => {
    const placement = captureWindowPlacement({ x: 192, y: 104, width: 960, height: 520 }, 'normal', displays);
    const resolved = resolveWindowPlacement(placement, [
      { id: 1, label: 'Primary', workArea: { x: 0, y: 0, width: 2560, height: 1400 }, primary: true }
    ]);
    expect(resolved.bounds).toEqual({ x: 256, y: 140, width: 1280, height: 700 });
  });

  it('falls back to the primary display and keeps every edge visible', () => {
    const placement = captureWindowPlacement({ x: 2100, y: 900, width: 900, height: 500 }, 'maximized', displays);
    placement.displayId = 99;
    placement.displayLabel = 'Disconnected';
    placement.normalizedBounds.x = 2;
    placement.normalizedBounds.y = 2;
    const resolved = resolveWindowPlacement(placement, [displays[0]]);
    expect(resolved.displayId).toBe(1);
    expect(resolved.windowState).toBe('maximized');
    expect(resolved.bounds.x + resolved.bounds.width).toBeLessThanOrEqual(1920);
    expect(resolved.bounds.y + resolved.bounds.height).toBeLessThanOrEqual(1040);
  });

  it('parses PowerShell window data without losing large handles', () => {
    const parsed = parseWindowsWindowList(JSON.stringify({
      handle: '9876543210',
      pid: 412,
      title: 'OBS 31.0.0',
      bounds: { x: -100, y: 20, width: 1280, height: 720 },
      windowState: 'maximized'
    }));
    expect(parsed).toEqual([{
      handle: '9876543210',
      pid: 412,
      title: 'OBS 31.0.0',
      bounds: { x: -100, y: 20, width: 1280, height: 720 },
      windowState: 'maximized'
    }]);
  });
});
