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

export interface TestConnectionResult {
  ok: boolean;
  stage: 'connect' | 'inputs';
  message: string;
  inputCount: number;
}

export interface AppConfig {
  obsHost: string;
  obsPort: number;
  obsPassword: string;
  targetInputName: string;
  silenceDurationSeconds: number;
  silenceThresholdDb: number;
  alertDisplayMode: AlertDisplayMode;
  alertDisplayId: number | null;
  paused: boolean;
  hasSeenGuide: boolean;
  preAlertEnabled: boolean;
  preAlertRatio: number;
  rememberAlertPosition: boolean;
  alertPositions: Record<string, AlertPosition>;
  floatingWindowEnabled: boolean;
  floatingWindowBounds: WindowBounds | null;
  autoLaunch: boolean;
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
  errorMessage: string | null;
}

export const DEFAULT_CONFIG: AppConfig = {
  obsHost: '127.0.0.1',
  obsPort: 4455,
  obsPassword: '',
  targetInputName: '',
  silenceDurationSeconds: 120,
  silenceThresholdDb: -55,
  alertDisplayMode: 'primary',
  alertDisplayId: null,
  paused: false,
  hasSeenGuide: false,
  preAlertEnabled: true,
  preAlertRatio: 0.75,
  rememberAlertPosition: true,
  alertPositions: {},
  floatingWindowEnabled: false,
  floatingWindowBounds: null,
  autoLaunch: false
};
