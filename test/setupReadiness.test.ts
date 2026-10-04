import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type AppSnapshot, type PreflightLaunchResult } from '../src/shared/types';
import { setupChecks, workspaceTrialPassed } from '../src/shared/setupReadiness';
const snapshot = { connected: false, inputs: [] } as unknown as AppSnapshot;
const running = { apps: [{ id: 'obs', state: 'running', path: 'obs.exe' }], failures: {}, restoreFailures: {}, projector: null } as unknown as PreflightLaunchResult;
describe('first use readiness', () => {
  it('never calls a disconnected empty setup ready', () => {
    expect(setupChecks(DEFAULT_CONFIG, snapshot, '', false, false).every(check => check.ready)).toBe(false);
    expect(setupChecks(DEFAULT_CONFIG, snapshot, '', false, false).filter(check => !check.ready)).toHaveLength(4);
  });
  it('requires verified audio to match the selected source and an acknowledged alert', () => {
    const config = { ...DEFAULT_CONFIG, targetInputName: 'Mic' };
    const connected = { ...snapshot, connected: true, inputs: [{ inputName: 'Mic' }] } as AppSnapshot;
    expect(setupChecks(config, connected, 'Old Mic', true, true).every(c => c.ready)).toBe(false);
    expect(setupChecks(config, connected, 'Mic', false, true).every(c => c.ready)).toBe(false);
    expect(setupChecks(config, connected, 'Mic', true, true).every(c => c.ready)).toBe(true);
    expect(setupChecks(config, connected, 'Mic', true, false, true).every(c => c.ready)).toBe(true);
  });
  it('does not require unused software or unsaved optional layouts', () => {
    expect(Object.entries(DEFAULT_CONFIG.preflightApps).filter(([, app]) => app.enabled).map(([id]) => id)).toEqual(['obs']);
    expect(DEFAULT_CONFIG.preflightProjector.restoreWindowPosition).toBe(false);
    expect(workspaceTrialPassed(DEFAULT_CONFIG, running)).toBe(true);
    expect(workspaceTrialPassed(DEFAULT_CONFIG, { ...running, apps: running.apps.map(app => ({ ...app, path: '' })) })).toBe(false);
  });
  it('requires selected layouts and enabled projectors to actually succeed', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.preflightApps.obs.restoreWindowPosition = true;
    expect(workspaceTrialPassed(config, running)).toBe(false);
    expect(workspaceTrialPassed(DEFAULT_CONFIG, { ...running, restoreFailures: { obs: 'failed' } })).toBe(false);
    config.preflightApps.obs.restoreWindowPosition = false;
    config.preflightProjector.enabled = true;
    expect(workspaceTrialPassed(config, running)).toBe(false);
    expect(workspaceTrialPassed(config, { ...running, projector: { state: 'opened', positionRestored: false, message: '' } })).toBe(true);
  });
});
