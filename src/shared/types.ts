export type MonitorStatus =
  | 'disconnected'
  | 'connecting'
  | 'idle_not_streaming'
  | 'monitoring'
  | 'silent_counting'
  | 'pre_alert'
  | 'alerting'
  | 'snoozed'
  | 'ignored_until_audio_returns'
  | 'paused'
  | 'error';

export type AlertDisplayMode = 'primary' | 'display_id' | 'all';
export type AlertReminderMode = 'classic' | 'toast' | 'both';

export type AlertAction = 'acknowledge' | 'snooze_10m' | 'ignore_once';

export type ReadinessReason =
  | 'ready'
  | 'obs_disconnected'
  | 'obs_connecting'
  | 'not_streaming_or_recording'
  | 'no_target_selected'
  | 'target_missing'
  | 'no_target_meter'
  | 'paused'
  | 'snoozed'
  | 'alerting'
  | 'error';

export type AlertHistoryAction = 'acknowledge' | 'ignore_once';

export interface AlertPosition {
  x: number;
  y: number;
}

export interface WindowBounds extends AlertPosition {
  width: number;
  height: number;
}

export interface AlertHistoryEntry {
  id: string;
  timestamp: number;
  inputName: string;
  silentForSeconds: number;
  action: AlertHistoryAction;
  status: MonitorStatus;
}

export interface SilenceEventEntry {
  id: string;
  inputName: string;
  startedAt: number;
  recoveredAt: number | null;
  durationSeconds: number;
  alertTriggered: boolean;
}

export interface InputMonitorSnapshot {
  inputName: string;
  inputKind: string;
  selected: boolean;
  lastLevelDb: number | null;
  lastMeterAt: number | null;
  silentForSeconds: number;
  secondsUntilAlert: number | null;
  status: 'normal' | 'silent' | 'missing_meter' | 'not_selected';
}

export interface VolumeHistoryPoint {
  timestamp: number;
  inputName: string;
  levelDb: number | null;
}

export interface OBSStatsSnapshot {
  cpuUsage: number | null;
  memoryUsageMb: number | null;
  availableDiskSpaceMb: number | null;
  activeFps: number | null;
  averageFrameRenderTimeMs: number | null;
  renderSkippedFrames: number | null;
  renderTotalFrames: number | null;
  outputSkippedFrames: number | null;
  outputTotalFrames: number | null;
  streamBitrateKbps: number | null;
}

export interface TestConnectionResult {
  ok: boolean;
  stage: 'connect' | 'inputs';
  message: string;
  inputCount: number;
}

export type UpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not_available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type UpdateSource = 'auto' | 'github' | 'gh_proxy' | 'ghproxy_net' | 'aliyun';
export type UpdateInstallMode = 'auto' | 'manual';

export interface UpdateSnapshot {
  status: UpdateStatus;
  source: UpdateSource;
  sourceLabel: string;
  sourceUrl: string | null;
  attemptedSources: string[];
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadedFilePath: string | null;
  installMode: UpdateInstallMode;
  percent: number | null;
  message: string;
  lastCheckedAt: number | null;
  errorMessage: string | null;
}

/** ATEM 导播台状态快照 (beta) */
export interface ATEMStateSnapshot {
  connected: boolean;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
  programInput: number;
  previewInput: number;
  inputLabels: Record<number, string>;
  inputCount: number;
  programInputStartedAt: number | null;
  programInputElapsedSeconds: number;
  programInputOverLimit: boolean;
  errorMessage: string | null;
}

/** ATEM 连接测试结果 (beta) */
export interface ATEMTestResult {
  ok: boolean;
  message: string;
  inputCount: number;
  modelName?: string;
}

/** ATEM 局域网发现设备 (beta) */
export interface ATEMDiscoveredDevice {
  host: string;
  label: string;
  inputCount: number;
  modelName?: string;
  interfaceName?: string;
  network?: string;
  message: string;
}

/** ATEM 局域网扫描结果 (beta) */
export interface ATEMScanResult {
  ok: boolean;
  message: string;
  scannedHosts: number;
  interfaces: string[];
  devices: ATEMDiscoveredDevice[];
}

export interface AppConfig {
  obsHost: string;
  obsPort: number;
  obsPassword: string;
  targetInputName: string;
  targetInputNames: string[];
  silenceDurationSeconds: number;
  silenceThresholdDb: number;
  alertDisplayMode: AlertDisplayMode;
  alertDisplayId: number | null;
  alertReminderMode: AlertReminderMode;
  alertSoundEnabled: boolean;
  paused: boolean;
  hasSeenGuide: boolean;
  guideSeenVersion: string;
  preAlertEnabled: boolean;
  preAlertRatio: number;
  rememberAlertPosition: boolean;
  alertPositions: Record<string, AlertPosition>;
  floatingWindowEnabled: boolean;
  floatingWindowBounds: WindowBounds | null;
  floatingWindowModules: {
    audio: boolean;
    atem: boolean;
    obsStats: boolean;
  };
  autoLaunch: boolean;
  updateSource: UpdateSource;
  aliyunUpdateBaseUrl: string;
  /** ATEM 导播台 (beta) */
  atemEnabled: boolean;
  atemHost: string;
  atemHotkeyGlobal: boolean;
  atemHardCutConfirm: boolean;
  atemCameraTimeAlertEnabled: boolean;
  atemCameraTimeLimitSeconds: number;
}

export interface InputOption {
  inputName: string;
  inputKind: string;
}

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  primary: boolean;
}

export interface AppSnapshot {
  config: AppConfig;
  status: MonitorStatus;
  inputs: InputOption[];
  displays: DisplayInfo[];
  connected: boolean;
  streaming: boolean;
  recording: boolean;
  simulatedLive: boolean;
  activeInputName: string;
  lastLevelDb: number | null;
  silentForSeconds: number;
  secondsUntilAlert: number | null;
  alertVisible: boolean;
  readinessReason: ReadinessReason;
  preAlertVisible: boolean;
  preAlertRemainingSeconds: number | null;
  preAlertDismissed: boolean;
  snoozedUntil: number | null;
  history: AlertHistoryEntry[];
  silenceEvents: SilenceEventEntry[];
  inputMonitors: InputMonitorSnapshot[];
  volumeHistory: VolumeHistoryPoint[];
  obsStats: OBSStatsSnapshot;
  errorMessage: string | null;
  /** ATEM 导播台状态 (beta) */
  atemConnected: boolean;
  atemConnectionState: string;
  atemProgramInput: number;
  atemPreviewInput: number;
  atemInputLabels: Record<number, string>;
  atemInputCount: number;
  atemProgramInputStartedAt: number | null;
  atemProgramInputElapsedSeconds: number;
  atemProgramInputOverLimit: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  obsHost: '127.0.0.1',
  obsPort: 4455,
  obsPassword: '',
  targetInputName: '',
  targetInputNames: [],
  silenceDurationSeconds: 120,
  silenceThresholdDb: -55,
  alertDisplayMode: 'all',
  alertDisplayId: null,
  alertReminderMode: 'classic',
  alertSoundEnabled: false,
  paused: false,
  hasSeenGuide: false,
  guideSeenVersion: '',
  preAlertEnabled: true,
  preAlertRatio: 0.75,
  rememberAlertPosition: true,
  alertPositions: {},
  floatingWindowEnabled: false,
  floatingWindowBounds: null,
  floatingWindowModules: {
    audio: true,
    atem: false,
    obsStats: false
  },
  autoLaunch: false,
  updateSource: 'auto',
  aliyunUpdateBaseUrl: '',
  /** ATEM 导播台 (beta) */
  atemEnabled: false,
  atemHost: '192.168.1.240',
  atemHotkeyGlobal: false,
  atemHardCutConfirm: true,
  atemCameraTimeAlertEnabled: true,
  atemCameraTimeLimitSeconds: 180
};
