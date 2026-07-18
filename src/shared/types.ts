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
export type AlertReminderMode = 'classic' | 'fullscreen';
export type AlertSoundPreset = 'clear' | 'strong' | 'low' | 'soft';
export type FloatingWindowMode = 'audio' | 'audio_atem' | 'multifunction';
export type RemoteAccessConnectionState = 'disabled' | 'connecting' | 'connected' | 'error';
export type RemoteRouteType = 'lan' | 'public' | 'custom' | null;
export const LAN_REMOTE_SERVER_URL = 'http://192.168.110.111:8088';
export const PUBLIC_REMOTE_SERVER_URL = 'https://obs.huaweilive.top:8088';

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

export interface ATEMSwitchHistoryEntry {
  id: string;
  switchedAt: number;
  fromInputId: number;
  fromInputLabel: string;
  toInputId: number;
  toInputLabel: string;
  startedAt: number;
  durationSeconds: number;
}

export interface ATEMInputCustomization {
  name: string;
  color: string;
  group: string;
}

export interface ATEMSessionSegment {
  id: string;
  inputId: number;
  inputLabel: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
}

export interface ATEMSessionUsage {
  inputId: number;
  inputLabel: string;
  color: string;
  group: string;
  durationSeconds: number;
  percent: number;
}

export interface ATEMLiveSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  segments: ATEMSessionSegment[];
  usage: ATEMSessionUsage[];
  totalDurationSeconds: number;
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

export interface AudioMeterFrame {
  timestamp: number;
  activeInputName: string;
  levelDb: number | null;
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

export type UpdateSource = 'auto' | 'github' | 'gh_proxy' | 'ghproxy_net' | 'aliyun' | 'lan';
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
  modelName: string | null;
  programInput: number;
  previewInput: number;
  inputIds: number[];
  inputLabels: Record<number, string>;
  inputCount: number;
  programInputStartedAt: number | null;
  programInputElapsedSeconds: number;
  programInputOverLimit: boolean;
  errorMessage: string | null;
  reconnectAttempt: number;
  nextReconnectAt: number | null;
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

export interface RemoteAccessSnapshot {
  connectionState: RemoteAccessConnectionState;
  connected: boolean;
  activeServerUrl: string | null;
  pairUrl: string | null;
  errorMessage: string | null;
  lastConnectedAt: number | null;
  routeType: RemoteRouteType;
  latencyMs: number | null;
  onlineMobileClients: number;
  lastSyncAt: number | null;
}

export const PREFLIGHT_APP_IDS = ['obs', 'douyin', 'browser', 'software_control', 'cosmic_cat'] as const;
export type PreflightAppId = typeof PREFLIGHT_APP_IDS[number];

export type PreflightPathSource = 'manual' | 'standard' | 'registry' | 'start_menu' | 'desktop' | 'unknown';

export interface PreflightAppConfig {
  enabled: boolean;
  path: string;
  restoreWindowPosition: boolean;
  pathSource: PreflightPathSource;
  customLabel: string;
  launchUrl: string;
}

export type PreflightAppConfigs = Record<PreflightAppId, PreflightAppConfig>;
export type PreflightPlacementTarget = PreflightAppId | 'obs_projector';
export type PreflightWindowState = 'normal' | 'maximized';

export interface PreflightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreflightWindowPlacement {
  displayId: number | null;
  displayLabel: string;
  capturedWorkArea: PreflightRect;
  normalizedBounds: PreflightRect;
  windowState: PreflightWindowState;
  capturedAt: number;
}

export type PreflightWindowPlacements = Partial<Record<PreflightPlacementTarget, PreflightWindowPlacement>>;

export interface PreflightProjectorConfig {
  enabled: boolean;
  restoreWindowPosition: boolean;
}

export interface PreflightSettings {
  apps: PreflightAppConfigs;
  projector: PreflightProjectorConfig;
  windowPlacements: PreflightWindowPlacements;
}

export interface PreflightDiscoveryItem {
  id: PreflightAppId;
  path: string;
  source: PreflightPathSource;
}

export interface PreflightDiscoveryResult {
  platform: 'windows' | 'macos' | 'linux';
  discovered: PreflightDiscoveryItem[];
  message: string;
}

export interface PreflightLayoutCaptureResult {
  platform: 'windows' | 'macos' | 'linux';
  placements: PreflightWindowPlacements;
  captured: PreflightPlacementTarget[];
  failures: Partial<Record<PreflightPlacementTarget, string>>;
  capturedAt: number;
}

export interface PreflightProjectorResult {
  state: 'disabled' | 'opened' | 'already_open' | 'failed';
  message: string;
  positionRestored: boolean;
}
export type PreflightAppState = 'running' | 'not_running' | 'not_configured' | 'unsupported' | 'error';

export interface PreflightAppStatus {
  id: PreflightAppId;
  state: PreflightAppState;
  path: string;
  pid: number | null;
  detectedProcessName: string | null;
  message: string;
}

export interface PreflightCheckResult {
  platform: 'windows' | 'macos' | 'linux';
  checkedAt: number;
  apps: PreflightAppStatus[];
}

export interface PreflightLaunchResult extends PreflightCheckResult {
  launched: PreflightAppId[];
  failures: Partial<Record<PreflightAppId, string>>;
  restored: PreflightPlacementTarget[];
  restoreFailures: Partial<Record<PreflightPlacementTarget, string>>;
  projector: PreflightProjectorResult | null;
}

export interface AppConfig {
  obsHost: string;
  obsPort: number;
  obsPassword: string;
  rememberObsPassword: boolean;
  targetInputName: string;
  targetInputNames: string[];
  silenceDurationSeconds: number;
  silenceThresholdDb: number;
  alertDisplayMode: AlertDisplayMode;
  alertDisplayId: number | null;
  alertReminderMode: AlertReminderMode;
  alertSoundEnabled: boolean;
  alertSoundPreset: AlertSoundPreset;
  paused: boolean;
  hasSeenGuide: boolean;
  guideSeenVersion: string;
  preAlertEnabled: boolean;
  preAlertRatio: number;
  rememberAlertPosition: boolean;
  alertPositions: Record<string, AlertPosition>;
  floatingWindowEnabled: boolean;
  floatingWindowMode: FloatingWindowMode;
  floatingWindowLayoutVersion: number;
  floatingWindowBounds: WindowBounds | null;
  floatingWindowModules: {
    audio: boolean;
    atem: boolean;
    obsStats: boolean;
  };
  remoteAccessEnabled: boolean;
  remoteServerUrl: string;
  remoteDeviceUuid: string;
  remoteDeviceSecret: string;
  developerModeEnabled: boolean;
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
  atemInputCustomizations: Record<string, ATEMInputCustomization>;
  preflightApps: PreflightAppConfigs;
  preflightProjector: PreflightProjectorConfig;
  preflightWindowPlacements: PreflightWindowPlacements;
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
  lastAudioMeterReceivedAt: number | null;
  audioSpeaking: boolean;
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
  atemModelName: string | null;
  atemProgramInput: number;
  atemPreviewInput: number;
  atemInputIds: number[];
  atemInputLabels: Record<number, string>;
  atemInputHardwareLabels: Record<number, string>;
  atemInputCount: number;
  atemProgramInputStartedAt: number | null;
  atemProgramInputElapsedSeconds: number;
  atemProgramInputOverLimit: boolean;
  atemSwitchHistory: ATEMSwitchHistoryEntry[];
  atemReconnectAttempt: number;
  atemNextReconnectAt: number | null;
  atemCurrentSession: ATEMLiveSession | null;
  atemRecentSessions: ATEMLiveSession[];
  remoteAccessConnectionState: RemoteAccessConnectionState;
  remoteAccessConnected: boolean;
  remoteAccessActiveServerUrl: string | null;
  remoteAccessPairUrl: string | null;
  remoteAccessErrorMessage: string | null;
  remoteAccessLastConnectedAt: number | null;
  remoteAccessRouteType: RemoteRouteType;
  remoteAccessLatencyMs: number | null;
  remoteAccessOnlineMobileClients: number;
  remoteAccessLastSyncAt: number | null;
}

export const DEFAULT_CONFIG: AppConfig = {
  obsHost: '127.0.0.1',
  obsPort: 4455,
  obsPassword: '',
  rememberObsPassword: true,
  targetInputName: '',
  targetInputNames: [],
  silenceDurationSeconds: 120,
  silenceThresholdDb: -55,
  alertDisplayMode: 'all',
  alertDisplayId: null,
  alertReminderMode: 'classic',
  alertSoundEnabled: false,
  alertSoundPreset: 'strong',
  paused: false,
  hasSeenGuide: false,
  guideSeenVersion: '',
  preAlertEnabled: true,
  preAlertRatio: 0.75,
  rememberAlertPosition: true,
  alertPositions: {},
  floatingWindowEnabled: false,
  floatingWindowMode: 'audio',
  floatingWindowLayoutVersion: 3,
  floatingWindowBounds: null,
  floatingWindowModules: {
    audio: true,
    atem: false,
    obsStats: false
  },
  remoteAccessEnabled: false,
  remoteServerUrl: 'https://obs.huaweilive.top:8088',
  remoteDeviceUuid: '',
  remoteDeviceSecret: '',
  developerModeEnabled: false,
  autoLaunch: false,
  updateSource: 'auto',
  aliyunUpdateBaseUrl: '',
  /** ATEM 导播台 (beta) */
  atemEnabled: false,
  atemHost: '192.168.1.240',
  atemHotkeyGlobal: false,
  atemHardCutConfirm: true,
  atemCameraTimeAlertEnabled: true,
  atemCameraTimeLimitSeconds: 600,
  atemInputCustomizations: {},
  preflightApps: {
    obs: { enabled: true, path: '', restoreWindowPosition: true, pathSource: 'unknown', customLabel: '', launchUrl: '' },
    douyin: { enabled: true, path: '', restoreWindowPosition: false, pathSource: 'unknown', customLabel: '', launchUrl: '' },
    browser: { enabled: true, path: '', restoreWindowPosition: false, pathSource: 'unknown', customLabel: '', launchUrl: '' },
    software_control: { enabled: true, path: '', restoreWindowPosition: false, pathSource: 'unknown', customLabel: '', launchUrl: '' },
    cosmic_cat: { enabled: true, path: '', restoreWindowPosition: false, pathSource: 'unknown', customLabel: '', launchUrl: '' }
  },
  preflightProjector: {
    enabled: false,
    restoreWindowPosition: true
  },
  preflightWindowPlacements: {}
};
