import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ObsGuardApi } from '../shared/ipc.js';
import type { AppConfig, AppSnapshot, AlertAction, AlertHistoryEntry, ATEMScanResult, ATEMSwitchHistoryEntry, AudioMeterFrame, PreflightAppId, PreflightCheckResult, PreflightDiscoveryResult, PreflightLayoutCaptureResult, PreflightLaunchResult, PreflightProjectorResult, PreflightSettings, TestConnectionResult, UpdateSnapshot } from '../shared/types.js';

const obsGuardApi = {
  getProjectorSafetyStatus: () => ipcRenderer.invoke('projector-safety:status') as Promise<import('../shared/projectorSafety.js').ProjectorSafetyStatus>,
  selectSafetyProjector: (handle: string) => ipcRenderer.invoke('projector-safety:select', handle) as Promise<void>,
  previewProjectorSafety: (config: import('../shared/projectorSafety.js').ProjectorSafetyConfig) => ipcRenderer.invoke('projector-safety:preview', config) as Promise<void>,
  floatingResize: (phase: 'start' | 'move' | 'end', edge?: string) => ipcRenderer.invoke('floating:resize', phase, edge) as Promise<void>,
  respondMonitoringPrompt: (accept: boolean) => ipcRenderer.invoke('monitor:prompt-response', accept) as Promise<void>,
  onWindowShown: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('window:shown', listener);
    return () => ipcRenderer.off('window:shown', listener);
  },
  onPreflightControlReleased: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('preflight:control-released', listener);
    return () => ipcRenderer.off('preflight:control-released', listener);
  },
  releasePreflightControl: () => ipcRenderer.invoke('preflight:release-control') as Promise<void>,
  getPreflightOverlayState: () => ipcRenderer.invoke('preflight:overlay-state') as Promise<import('../shared/types.js').PreflightProgress>,
  restorePreflightTarget: (target: import('../shared/types.js').PreflightPlacementTarget, settings: PreflightSettings) => ipcRenderer.invoke('preflight:restore-target', target, settings) as Promise<void>,
  onPreflightProgress: (callback: (progress: import('../shared/types.js').PreflightProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: import('../shared/types.js').PreflightProgress) => callback(progress);
    ipcRenderer.on('preflight:progress', listener);
    return () => ipcRenderer.off('preflight:progress', listener);
  },
  getSnapshot: () => ipcRenderer.invoke('snapshot:get') as Promise<AppSnapshot>,
  saveConfig: (patch: Partial<AppConfig>) => ipcRenderer.invoke('config:save', patch) as Promise<AppSnapshot>,
  resetConfig: () => ipcRenderer.invoke('config:reset') as Promise<AppSnapshot>,
  refreshInputs: () => ipcRenderer.invoke('inputs:refresh'),
  reconnect: () => ipcRenderer.invoke('obs:reconnect') as Promise<AppSnapshot>,
  testConnection: (patch: Partial<AppConfig>) =>
    ipcRenderer.invoke('obs:test-connection', patch) as Promise<TestConnectionResult>,
  setMonitoringActive: (active: boolean) => ipcRenderer.invoke('monitor:set-active', active) as Promise<AppSnapshot>,
  setPaused: (paused: boolean) => ipcRenderer.invoke('monitor:set-paused', paused) as Promise<AppSnapshot>,
  setSimulatedLive: (enabled: boolean) => ipcRenderer.invoke('monitor:set-simulated-live', enabled) as Promise<AppSnapshot>,
  testAlert: () => ipcRenderer.invoke('alert:test') as Promise<AppSnapshot>,
  alertAction: (action: AlertAction) => ipcRenderer.invoke('alert:action', action) as Promise<AppSnapshot>,
  forceCloseAlert: () => ipcRenderer.invoke('alert:force-close') as Promise<AppSnapshot>,
  dismissPreAlert: () => ipcRenderer.invoke('prealert:dismiss') as Promise<AppSnapshot>,
  setFloatingWindowVisible: (visible: boolean) => ipcRenderer.invoke('floating:set-visible', visible) as Promise<AppSnapshot>,
  showSettings: () => ipcRenderer.invoke('settings:show') as Promise<void>,
  listHistory: () => ipcRenderer.invoke('history:list') as Promise<AlertHistoryEntry[]>,
  clearHistory: () => ipcRenderer.invoke('history:clear') as Promise<AlertHistoryEntry[]>,
  updateAlertPosition: (displayId: number, position: { x: number; y: number }) =>
    ipcRenderer.invoke('alert:position-updated', displayId, position) as Promise<void>,
  getDisplays: () => ipcRenderer.invoke('displays:get'),
  checkPreflightApps: (settings: PreflightSettings) => ipcRenderer.invoke('preflight:check', settings) as Promise<PreflightCheckResult>,
  launchPreflightApps: (settings: PreflightSettings) => ipcRenderer.invoke('preflight:launch-all', settings) as Promise<PreflightLaunchResult>,
  launchPreflightApp: (id: PreflightAppId, settings: PreflightSettings, retry = false) => ipcRenderer.invoke('preflight:launch', id, settings, retry) as Promise<PreflightLaunchResult>,
  discoverPreflightApps: () => ipcRenderer.invoke('preflight:discover') as Promise<PreflightDiscoveryResult>,
  capturePreflightLayout: (settings: PreflightSettings, target?: import('../shared/types.js').PreflightPlacementTarget) => ipcRenderer.invoke('preflight:capture-layout', settings, target) as Promise<PreflightLayoutCaptureResult>,
  openPreflightProjector: (settings: PreflightSettings) => ipcRenderer.invoke('preflight:open-projector', settings) as Promise<PreflightProjectorResult>,
  pickPreflightTarget: (id: PreflightAppId) => ipcRenderer.invoke('preflight:pick-target', id) as Promise<string | null>,
  getDroppedPreflightPath: (file: File) => webUtils.getPathForFile(file),
  onSnapshot: (callback: (snapshot: AppSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => callback(snapshot);
    ipcRenderer.on('snapshot', listener);

    return () => {
      ipcRenderer.off('snapshot', listener);
    };
  },
  onMeter: (callback: (frame: AudioMeterFrame) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, frame: AudioMeterFrame) => callback(frame);
    ipcRenderer.on('meter:update', listener);

    return () => {
      ipcRenderer.off('meter:update', listener);
    };
  },
  /** ATEM 导播台 API */
  getATEMState: () => ipcRenderer.invoke('atem:get-state'),
  clearATEMHistory: () => ipcRenderer.invoke('atem:history-clear') as Promise<ATEMSwitchHistoryEntry[]>,
  changePreviewInput: (input: number) => ipcRenderer.invoke('atem:change-preview-input', input),
  autoTransition: () => ipcRenderer.invoke('atem:auto-transition'),
  changeProgramInput: (input: number) => ipcRenderer.invoke('atem:change-program-input', input),
  testATEMConnection: (host: string) => ipcRenderer.invoke('atem:test-connection', host),
  scanATEMNetwork: (host?: string) => ipcRenderer.invoke('atem:scan-network', host) as Promise<ATEMScanResult>,
  atemReconnect: () => ipcRenderer.invoke('atem:reconnect')
} satisfies ObsGuardApi;

contextBridge.exposeInMainWorld('obsGuard', obsGuardApi);
