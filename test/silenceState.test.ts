import { describe, expect, it } from 'vitest';
import {
  initialRuntimeState,
  isPreAlertVisible,
  preAlertRemainingSeconds,
  reducePreAlertDismiss,
  reduceAlertAction,
  reduceAudioLevel,
  reduceMonitoringActive,
  secondsUntilAlert
} from '../src/shared/silenceState.js';
import { DEFAULT_CONFIG, type AppConfig } from '../src/shared/types.js';

const config: AppConfig = {
  ...DEFAULT_CONFIG,
  targetInputName: 'Mic',
  silenceDurationSeconds: 120,
  silenceThresholdDb: -55
};

describe('silence monitor state', () => {
  it('alerts after the configured continuous silence duration', () => {
    const now = 1_000;
    let state = {
      ...initialRuntimeState,
      connected: true
    };

    state = reduceMonitoringActive(state, config, true, now);
    state = reduceAudioLevel(state, config, -80, now);
    expect(state.status).toBe('silent_counting');
    expect(secondsUntilAlert(state, config, now + 60_000)).toBe(60);

    state = reduceAudioLevel(state, config, -82, now + 120_000);
    expect(state.alertVisible).toBe(true);
    expect(state.status).toBe('alerting');
  });

  it('enters pre-alert at seventy-five percent of the silence duration', () => {
    const now = 1_000;
    let state = {
      ...initialRuntimeState,
      connected: true
    };

    state = reduceMonitoringActive(state, config, true, now);
    state = reduceAudioLevel(state, config, -80, now);

    expect(isPreAlertVisible(state, config, now + 89_000)).toBe(false);
    expect(isPreAlertVisible(state, config, now + 90_000)).toBe(true);
    expect(preAlertRemainingSeconds(state, config, now + 90_000)).toBe(30);

    state = reduceAudioLevel(state, config, -80, now + 120_000);
    expect(state.alertVisible).toBe(true);
    expect(isPreAlertVisible(state, config, now + 120_000)).toBe(false);
  });

  it('dismisses one pre-alert without cancelling the final alert', () => {
    const now = 1_000;
    let state = {
      ...initialRuntimeState,
      connected: true
    };

    state = reduceMonitoringActive(state, config, true, now);
    state = reduceAudioLevel(state, config, -80, now);

    expect(isPreAlertVisible(state, config, now + 90_000)).toBe(true);
    state = reducePreAlertDismiss(state, config, now + 90_000);

    expect(isPreAlertVisible(state, config, now + 91_000)).toBe(false);
    expect(state.preAlertDismissedSilentSince).toBe(state.silentSince);

    state = reduceAudioLevel(state, config, -82, now + 120_000);
    expect(state.alertVisible).toBe(true);
    expect(state.status).toBe('alerting');
  });

  it('allows a new pre-alert after dismissed silence is cleared by audio', () => {
    const now = 1_000;
    let state = {
      ...initialRuntimeState,
      connected: true
    };

    state = reduceMonitoringActive(state, config, true, now);
    state = reduceAudioLevel(state, config, -80, now);
    state = reducePreAlertDismiss(state, config, now + 90_000);
    state = reduceAudioLevel(state, config, -20, now + 95_000);

    expect(state.silentSince).toBeNull();
    expect(state.preAlertDismissedSilentSince).toBeNull();

    state = reduceAudioLevel(state, config, -80, now + 100_000);
    expect(isPreAlertVisible(state, config, now + 190_000)).toBe(true);
  });

  it('clears silence when audio returns', () => {
    const now = 1_000;
    let state = {
      ...initialRuntimeState,
      connected: true
    };

    state = reduceMonitoringActive(state, config, true, now);
    state = reduceAudioLevel(state, config, -80, now);
    state = reduceAudioLevel(state, config, -20, now + 30_000);

    expect(state.silentSince).toBeNull();
    expect(state.status).toBe('monitoring');
  });

  it.each(['acknowledge', 'pause'] as const)('closes an alert and resets the timer for %s', (action) => {
    const now = 1_000;
    const state = reduceAlertAction(
      {
        ...initialRuntimeState,
        monitoringActive: true,
        connected: true,
        streaming: true,
        alertVisible: true,
        silentSince: now - 120_000
      },
      config,
      action,
      now
    );

    expect(state.alertVisible).toBe(false);
    expect(state.silentSince).toBeNull();
    expect(state.status).toBe('monitoring');
  });

  it('counts silence while manually active even when OBS is not streaming or recording', () => {
    let state = reduceMonitoringActive(
      {
        ...initialRuntimeState,
        connected: true
      },
      config,
      true,
      1_000
    );
    state = reduceAudioLevel(
      state,
      config,
      -80,
      1_000
    );

    expect(state.silentSince).toBe(1_000);
    expect(state.status).toBe('silent_counting');
  });

  it('clears silence immediately when monitoring stops', () => {
    const now = 1_000;
    let state = reduceMonitoringActive(
      { ...initialRuntimeState, connected: true },
      config,
      true,
      now
    );
    state = reduceAudioLevel(state, config, -80, now);
    state = reduceMonitoringActive(state, config, false, now + 5_000);

    expect(state.silentSince).toBeNull();
    expect(state.alertVisible).toBe(false);
    expect(state.status).toBe('paused');
  });
});
