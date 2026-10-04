import { afterEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ windows: [] as any[] }));
vi.mock('electron', () => ({
  screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, { bounds: { x: -1280, y: 0, width: 1280, height: 720 } }] },
  BrowserWindow: class {
    handlers: Record<string, () => void> = {}; destroyed = false;
    webContents = { on: (event: string, callback: () => void) => { this.handlers[event] = callback; }, send: vi.fn() };
    constructor(public options: unknown) { fixture.windows.push(this); }
    on(event: string, callback: () => void) { this.handlers[event] = callback; }
    once(event: string, callback: () => void) { this.handlers[event] = callback; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setSimpleFullScreen() {} setBounds() {} show() {}
  }
}));
import { LaunchOverlay } from '../src/main/launchOverlay';
afterEach(() => { fixture.windows.length = 0; vi.useRealTimers(); });
describe('desktop launch cover lifecycle', () => {
  it('covers every display and removes all covers when complete', () => {
    const cancel = vi.fn(); const cover = new LaunchOverlay('preload', vi.fn(), cancel);
    cover.show(); expect(fixture.windows).toHaveLength(2);
    for (const window of fixture.windows) window.handlers['ready-to-show']();
    cover.report('正在恢复 OBS', 70);
    for (const window of fixture.windows) expect(window.webContents.send).toHaveBeenCalledWith('preflight:progress', expect.objectContaining({ percent: 70 }));
    cover.close(); expect(fixture.windows.every(window => window.destroyed)).toBe(true); expect(cancel).not.toHaveBeenCalled();
  });
  it('hands control back if the renderer crashes or the timeout expires', () => {
    vi.useFakeTimers();
    let cover: LaunchOverlay;
    const cancel = vi.fn(() => cover.close());
    cover = new LaunchOverlay('preload', vi.fn(), cancel); cover.show();
    fixture.windows[0].handlers['render-process-gone']();
    expect(fixture.windows.every(window => window.destroyed)).toBe(true);
    cover.show(); vi.advanceTimersByTime(180_000);
    expect(cancel).toHaveBeenCalledTimes(2); expect(fixture.windows.every(window => window.destroyed)).toBe(true);
  });
});
