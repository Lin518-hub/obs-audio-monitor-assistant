import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ dialog: vi.fn(), destroy: vi.fn(), show: vi.fn() }));
vi.mock('electron', () => ({
  dialog: { showMessageBox: mocks.dialog }, screen: { screenToDipRect: (_: unknown, rect: unknown) => rect },
  BrowserWindow: class {
    setIgnoreMouseEvents() {} async loadURL() {} showInactive() { mocks.show(); } destroy() { mocks.destroy(); }
  }
}));
import { confirmLayoutWindow } from '../src/main/confirmLayoutWindow';
const window = { handle: '1', title: 'OBS', pid: 42, bounds: { x: 0, y: 0, width: 900, height: 600 }, windowState: 'normal' as const };
describe('layout confirmation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('highlights and returns only an explicitly confirmed window', async () => {
    mocks.dialog.mockResolvedValueOnce({ response: 0 });
    expect(await confirmLayoutWindow('OBS', window, [window])).toBe(window);
    expect(mocks.show).toHaveBeenCalledOnce(); expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it('allows manual selection when automatic recognition fails', async () => {
    mocks.dialog.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 0 });
    expect(await confirmLayoutWindow('OBS', null, [window])).toBe(window);
  });
  it('skips without capturing and always removes the highlight', async () => {
    mocks.dialog.mockResolvedValueOnce({ response: 2 });
    expect(await confirmLayoutWindow('OBS', window, [window])).toBeNull();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
