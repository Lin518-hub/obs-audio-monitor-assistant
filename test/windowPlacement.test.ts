import { describe, expect, it } from 'vitest';
import { isOBSProjectorWindow, parseWindowsDisplayList, parseWindowsWindowList, selectNewOBSProjectorWindow } from '../src/main/windowsWindowManager.js';
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

  it('keeps a saved window on the same physical monitor when Windows display ids change', () => {
    const placement = captureWindowPlacement({ x: 2048, y: 102, width: 640, height: 512 }, 'normal', displays);
    const resolved = resolveWindowPlacement(placement, [
      { id: 2, label: '\\\\.\\DISPLAY2', workArea: displays[0].workArea, primary: true },
      { id: 1, label: '\\\\.\\DISPLAY1', workArea: { x: 1920, y: 0, width: 1440, height: 1080 }, primary: false }
    ]);
    expect(resolved.displayId).toBe(1);
    expect(resolved.bounds.x).toBeGreaterThanOrEqual(1920);
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

  it('parses native Windows monitor work areas used by window capture and restore', () => {
    expect(parseWindowsDisplayList(JSON.stringify([
      { id: 1, label: '\\\\.\\DISPLAY1', workArea: { x: 0, y: 0, width: 1920, height: 1040 }, primary: true },
      { id: 2, label: '\\\\.\\DISPLAY2', workArea: { x: 1920, y: -200, width: 2560, height: 1400 }, primary: false }
    ]))).toHaveLength(2);
  });

  it('recognizes localized OBS program projector windows but excludes multiview', () => {
    const base = { handle: '1', pid: 10, bounds: { x: 0, y: 0, width: 800, height: 450 }, windowState: 'normal' as const };
    expect(isOBSProjectorWindow({ ...base, title: '窗口化投影（节目）' })).toBe(true);
    expect(isOBSProjectorWindow({ ...base, title: 'Windowed Projector (Program)' })).toBe(true);
    expect(isOBSProjectorWindow({ ...base, title: '窗口化投影（多画面）' })).toBe(false);
    expect(isOBSProjectorWindow({ ...base, title: 'Windowed Projector (Scene) - Camera 1' })).toBe(false);
    expect(isOBSProjectorWindow({ ...base, title: '窗口化投影（来源）- 摄像头' })).toBe(false);
  });

  it('falls back to a newly opened video-sized OBS window when its localized projector title is unknown', () => {
    const windows = [
      { handle: 'dialog', pid: 10, title: '缺失文件', bounds: { x: 10, y: 10, width: 520, height: 280 }, windowState: 'normal' as const },
      { handle: 'projector', pid: 10, title: 'OBS 输出画面', bounds: { x: 100, y: 100, width: 960, height: 540 }, windowState: 'normal' as const }
    ];
    expect(selectNewOBSProjectorWindow(windows)?.handle).toBe('projector');
  });
});
