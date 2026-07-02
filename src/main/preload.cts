import { contextBridge, ipcRenderer } from 'electron';
import type { AppConfig, AppSnapshot, AlertAction, AlertHistoryEntry, TestConnectionResult, UpdateSnapshot } from '../shared/types.js';

contextBridge.exposeInMainWorld('obsGuard', {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get') as Promise<AppSnapshot>,
  saveConfig: (patch: Partial<AppConfig>) => ipcRenderer.invoke('config:save', patch) as Promise<AppSnapshot>,
  resetConfig: () => ipcRenderer.invoke('config:reset') as Promise<AppSnapshot>,
  refreshInputs: () => ipcRenderer.invoke('inputs:refresh'),
  reconnect: () => ipcRenderer.invoke('obs:reconnect') as Promise<AppSnapshot>,
  testConnection: (patch: Partial<AppConfig>) =>
    ipcRenderer.invoke('obs:test-connection', patch) as Promise<TestConnectionResult>,
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
  getUpdateState: () => ipcRenderer.invoke('update:get-state') as Promise<UpdateSnapshot>,
  checkForUpdates: () => ipcRenderer.invoke('update:check') as Promise<UpdateSnapshot>,
  downloadUpdate: () => ipcRenderer.invoke('update:download') as Promise<UpdateSnapshot>,
  installUpdate: () => ipcRenderer.invoke('update:install') as Promise<UpdateSnapshot>,
  onSnapshot: (callback: (snapshot: AppSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => callback(snapshot);
    ipcRenderer.on('snapshot', listener);

    return () => {
      ipcRenderer.off('snapshot', listener);
    };
  },
  onUpdateState: (callback: (snapshot: UpdateSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: UpdateSnapshot) => callback(snapshot);
    ipcRenderer.on('update:state', listener);

    return () => {
      ipcRenderer.off('update:state', listener);
    };
  }
});
