import { isSilent } from './audio.js';
import type { AlertAction, AppConfig, MonitorStatus } from './types.js';

export interface MonitorRuntimeState {
  status: MonitorStatus;
  connected: boolean;
  streaming: boolean;
  recording: boolean;
  lastLevelDb: number | null;
  silentSince: number | null;
  alertVisible: boolean;
  preAlertDismissedSilentSince: number | null;
  snoozedUntil: number | null;
  ignoredUntilAudioReturns: boolean;
}

export const initialRuntimeState: MonitorRuntimeState = {
  status: 'disconnected',
  connected: false,
  streaming: false,
  recording: false,
  lastLevelDb: null,
  silentSince: null,
  alertVisible: false,
  preAlertDismissedSilentSince: null,
  snoozedUntil: null,
  ignoredUntilAudioReturns: false
};

export function deriveStatus(state: MonitorRuntimeState, config: AppConfig, now: number): MonitorStatus {
  if (config.paused) {
    return 'paused';
  }

  if (!state.connected) {
    return 'disconnected';
  }

  if (state.snoozedUntil !== null && state.snoozedUntil > now) {
    return 'snoozed';
  }

  if (state.ignoredUntilAudioReturns) {
    return 'ignored_until_audio_returns';
  }

  if (!state.streaming && !state.recording) {
    return 'idle_not_streaming';
  }

  if (state.alertVisible) {
    return 'alerting';
  }

  if (state.silentSince !== null && isPreAlertVisible(state, config, now)) {
    return 'pre_alert';
  }

  if (state.silentSince !== null) {
    return 'silent_counting';
  }

  return 'monitoring';
}

export function secondsUntilAlert(state: MonitorRuntimeState, config: AppConfig, now: number): number | null {
  if (state.silentSince === null || state.alertVisible) {
    return null;
  }

  return Math.max(0, config.silenceDurationSeconds - Math.floor((now - state.silentSince) / 1000));
}

export function preAlertThresholdSeconds(config: AppConfig): number {
  const ratio = Math.min(0.95, Math.max(0.1, config.preAlertRatio));
  return Math.max(1, Math.floor(config.silenceDurationSeconds * ratio));
}

export function isPreAlertVisible(state: MonitorRuntimeState, config: AppConfig, now: number): boolean {
  if (!config.preAlertEnabled || state.silentSince === null || state.alertVisible) {
    return false;
  }

  if (state.preAlertDismissedSilentSince === state.silentSince) {
    return false;
  }

  const silentSeconds = silentForSeconds(state, now);
  return silentSeconds >= preAlertThresholdSeconds(config) && silentSeconds < config.silenceDurationSeconds;
}

export function preAlertRemainingSeconds(state: MonitorRuntimeState, config: AppConfig, now: number): number | null {
  if (!isPreAlertVisible(state, config, now)) {
    return null;
  }

  return secondsUntilAlert(state, config, now);
}

export function silentForSeconds(state: MonitorRuntimeState, now: number): number {
  if (state.silentSince === null) {
    return 0;
  }

  return Math.max(0, Math.floor((now - state.silentSince) / 1000));
}

export function reduceAudioLevel(
  state: MonitorRuntimeState,
  config: AppConfig,
  levelDb: number,
  now: number
): MonitorRuntimeState {
  let next: MonitorRuntimeState = {
    ...state,
    lastLevelDb: levelDb
  };

  const canMonitor =
    next.connected &&
    !config.paused &&
    (next.streaming || next.recording) &&
    !(next.snoozedUntil !== null && next.snoozedUntil > now);

  if (!canMonitor) {
    return {
      ...next,
      silentSince: null,
      status: deriveStatus(next, config, now)
    };
  }

  if (!isSilent(levelDb, config.silenceThresholdDb)) {
    next = {
      ...next,
      silentSince: null,
      alertVisible: false,
      preAlertDismissedSilentSince: null,
      ignoredUntilAudioReturns: false
    };
    return {
      ...next,
      status: deriveStatus(next, config, now)
    };
  }

  if (next.ignoredUntilAudioReturns || next.alertVisible) {
    return {
      ...next,
      status: deriveStatus(next, config, now)
    };
  }

  const silentSince = next.silentSince ?? now;
  const shouldAlert = now - silentSince >= config.silenceDurationSeconds * 1000;
  next = {
    ...next,
    silentSince,
    alertVisible: shouldAlert
  };

  return {
    ...next,
    status: deriveStatus(next, config, now)
  };
}

export function reduceOutputState(
  state: MonitorRuntimeState,
  config: AppConfig,
  streaming: boolean,
  recording: boolean,
  now: number
): MonitorRuntimeState {
  const shouldReset = !streaming && !recording;
  const next: MonitorRuntimeState = {
    ...state,
    streaming,
    recording,
    silentSince: shouldReset ? null : state.silentSince,
    alertVisible: shouldReset ? false : state.alertVisible,
    preAlertDismissedSilentSince: shouldReset ? null : state.preAlertDismissedSilentSince,
    ignoredUntilAudioReturns: shouldReset ? false : state.ignoredUntilAudioReturns
  };

  return {
    ...next,
    status: deriveStatus(next, config, now)
  };
}

export function reduceAlertAction(
  state: MonitorRuntimeState,
  config: AppConfig,
  action: AlertAction,
  now: number
): MonitorRuntimeState {
  let next: MonitorRuntimeState;

  if (action === 'snooze_10m') {
    next = {
      ...state,
      alertVisible: false,
      silentSince: null,
      preAlertDismissedSilentSince: null,
      snoozedUntil: now + 10 * 60 * 1000,
      ignoredUntilAudioReturns: false
    };
  } else if (action === 'ignore_once') {
    next = {
      ...state,
      alertVisible: false,
      silentSince: null,
      preAlertDismissedSilentSince: null,
      snoozedUntil: now + 5 * 60 * 1000,
      ignoredUntilAudioReturns: false
    };
  } else {
    next = {
      ...state,
      alertVisible: false,
      silentSince: null,
      preAlertDismissedSilentSince: null
    };
  }

  return {
    ...next,
    status: deriveStatus(next, config, now)
  };
}

export function reducePreAlertDismiss(state: MonitorRuntimeState, config: AppConfig, now: number): MonitorRuntimeState {
  if (state.silentSince === null || state.alertVisible) {
    return {
      ...state,
      status: deriveStatus(state, config, now)
    };
  }

  const next: MonitorRuntimeState = {
    ...state,
    preAlertDismissedSilentSince: state.silentSince
  };

  return {
    ...next,
    status: deriveStatus(next, config, now)
  };
}
