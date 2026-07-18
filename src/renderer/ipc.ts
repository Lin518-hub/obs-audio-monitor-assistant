/**
 * 集中声明 window.obsGuard API 的 TypeScript 类型。
 * 真实实现在 src/main/preload.cts,这里只做类型声明,避免每个组件重复写。
 */
import type { AlertAction, AppConfig, AppSnapshot, ATEMScanResult, ATEMTestResult, AudioMeterFrame, InputOption, PreflightAppId, PreflightCheckResult, PreflightDiscoveryResult, PreflightLayoutCaptureResult, PreflightLaunchResult, PreflightProjectorResult, PreflightSettings, TestConnectionResult, UpdateSnapshot } from '../shared/types';

export interface ObsGuardApi {
  getSnapshot: () => Promise<AppSnapshot>;
  saveConfig: (patch: Partial<AppConfig>) => Promise<AppSnapshot>;
  resetConfig: () => Promise<AppSnapshot>;
  refreshInputs: () => Promise<InputOption[]>;
  reconnect: () => Promise<AppSnapshot>;
  testConnection: (patch: Partial<AppConfig>) => Promise<TestConnectionResult>;
  setPaused: (paused: boolean) => Promise<AppSnapshot>;
  setSimulatedLive: (enabled: boolean) => Promise<AppSnapshot>;
  testAlert: () => Promise<AppSnapshot>;
  alertAction: (action: AlertAction) => Promise<AppSnapshot>;
  forceCloseAlert: () => Promise<AppSnapshot>;
  dismissPreAlert: () => Promise<AppSnapshot>;
  setFloatingWindowVisible: (visible: boolean) => Promise<AppSnapshot>;
  showSettings: () => Promise<void>;
  listHistory: () => Promise<AppSnapshot['history']>;
  clearHistory: () => Promise<AppSnapshot['history']>;
  updateAlertPosition: (displayId: number, position: { x: number; y: number }) => Promise<void>;
  getDisplays: () => Promise<AppSnapshot['displays']>;
  getUpdateState: () => Promise<UpdateSnapshot>;
  checkForUpdates: () => Promise<UpdateSnapshot>;
  downloadUpdate: () => Promise<UpdateSnapshot>;
  installUpdate: () => Promise<UpdateSnapshot>;
  checkPreflightApps: (settings: PreflightSettings) => Promise<PreflightCheckResult>;
  launchPreflightApps: (settings: PreflightSettings) => Promise<PreflightLaunchResult>;
  launchPreflightApp: (id: PreflightAppId, settings: PreflightSettings) => Promise<PreflightLaunchResult>;
  discoverPreflightApps: () => Promise<PreflightDiscoveryResult>;
  capturePreflightLayout: (settings: PreflightSettings) => Promise<PreflightLayoutCaptureResult>;
  openPreflightProjector: (settings: PreflightSettings) => Promise<PreflightProjectorResult>;
  pickPreflightTarget: (id: PreflightAppId) => Promise<string | null>;
  onSnapshot: (cb: (snapshot: AppSnapshot) => void) => () => void;
  onMeter: (cb: (frame: AudioMeterFrame) => void) => () => void;
  onUpdateState: (cb: (snapshot: UpdateSnapshot) => void) => () => void;
  /** ATEM 导播台 API (beta) */
  getATEMState: () => Promise<AppSnapshot>;
  clearATEMHistory: () => Promise<AppSnapshot['atemSwitchHistory']>;
  changePreviewInput: (input: number) => Promise<void>;
  autoTransition: () => Promise<void>;
  changeProgramInput: (input: number) => Promise<void>;
  testATEMConnection: (host: string) => Promise<ATEMTestResult>;
  scanATEMNetwork: (host?: string) => Promise<ATEMScanResult>;
  atemReconnect: () => Promise<void>;
}

declare global {
  interface Window {
    obsGuard: ObsGuardApi;
  }
}
