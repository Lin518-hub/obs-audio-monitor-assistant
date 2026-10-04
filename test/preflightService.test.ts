import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, PREFLIGHT_APP_IDS, type PreflightSettings, type PreflightCheckResult } from '../src/shared/types';
vi.mock('electron', () => ({ screen: {}, shell: { readShortcutLink: vi.fn() } }));
vi.mock('../src/main/preflightDiscovery.js', () => ({ discoverPreflightApps: vi.fn() }));
import { PreflightCheckService } from '../src/main/preflightCheck';
const settings = (): PreflightSettings => ({ apps: structuredClone(DEFAULT_CONFIG.preflightApps), projector: { enabled: false, restoreWindowPosition: false }, windowPlacements: {} });
const checked = (): PreflightCheckResult => ({ platform: 'windows', checkedAt: Date.now(), apps: PREFLIGHT_APP_IDS.map(id => ({ id, state: 'running', path: '', pid: 1, detectedProcessName: 'test', message: '' })) });
const placement = { displayId: 1, displayLabel: 'test', capturedWorkArea: { x: 0, y: 0, width: 1920, height: 1080 }, normalizedBounds: { x: 0, y: 0, width: .5, height: .5 }, windowState: 'normal' as const, capturedAt: 1 };
describe('preflight recovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('retries an existing browser layout without reopening its configured URL', async () => {
    const service = new PreflightCheckService();
    const config = settings(); config.apps.browser.launchUrl = 'https://example.com'; config.apps.browser.restoreWindowPosition = true; config.windowPlacements.browser = placement;
    vi.spyOn(service, 'check').mockResolvedValue(checked());
    const restore = vi.spyOn(service, 'restoreTarget').mockResolvedValue();
    const launch = vi.spyOn(service as any, 'launchConfiguredApp').mockResolvedValue(undefined);
    const promise = service.launch('browser', config, true);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(launch).not.toHaveBeenCalled(); expect(restore).toHaveBeenCalledWith('browser', config); expect(result.restored).toEqual(['browser']);
  });
  it('does not restart healthy apps when retrying a failed target', async () => {
    const service = new PreflightCheckService(); const config = settings();
    const before = checked(); before.apps.find(app => app.id === 'douyin')!.state = 'not_running';
    vi.spyOn(service, 'check').mockResolvedValueOnce(before).mockResolvedValue(checked());
    const launch = vi.spyOn(service as any, 'launchConfiguredApp').mockResolvedValue(undefined);
    const promise = service.launch('douyin', config, true); await vi.runAllTimersAsync(); await promise;
    expect(launch).toHaveBeenCalledTimes(1); expect(launch.mock.calls[0][0]).toBe('douyin');
  });
  it('stops before any further launch after control is handed back', async () => {
    const service = new PreflightCheckService(); vi.spyOn(service, 'check').mockResolvedValue(checked());
    const launch = vi.spyOn(service as any, 'launchConfiguredApp').mockResolvedValue(undefined);
    service.cancel(); await expect(service.launchAll(settings())).rejects.toThrow('已取消'); expect(launch).not.toHaveBeenCalled();
    service.begin(); expect(() => service.assertActive()).not.toThrow();
  });
  it('reports a launched process that never becomes ready as a retryable failure', async () => {
    const service = new PreflightCheckService();
    const state = checked(); state.apps.find(app => app.id === 'browser')!.state = 'not_running';
    vi.spyOn(service, 'check').mockResolvedValue(state);
    vi.spyOn(service as any, 'launchConfiguredApp').mockResolvedValue(undefined);
    const promise = service.launch('browser', settings(), true);
    await vi.runAllTimersAsync();
    expect((await promise).failures.browser).toContain('15 秒');
  });
  it('keeps restoration failures separate from startup failures', async () => {
    const service = new PreflightCheckService(); const config = settings(); config.windowPlacements.browser = placement; config.apps.browser.restoreWindowPosition = true;
    vi.spyOn(service, 'check').mockResolvedValue(checked());
    vi.spyOn(service, 'restoreTarget').mockRejectedValue(new Error('窗口位置未保持'));
    const promise = service.launch('browser', config, true); await vi.runAllTimersAsync(); const result = await promise;
    expect(result.failures).toEqual({}); expect(result.restoreFailures.browser).toContain('窗口位置');
  });
});
