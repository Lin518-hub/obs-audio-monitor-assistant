import { describe, expect, it, vi } from 'vitest';
import { OBSMonitor } from '../src/main/obsMonitor.js';
import { DEFAULT_CONFIG, type AppConfig, type DisplayInfo } from '../src/shared/types.js';

const config: AppConfig = {
  ...DEFAULT_CONFIG,
  targetInputName: 'Mic',
  silenceDurationSeconds: 120
};

const displays: DisplayInfo[] = [
  {
    id: 1,
    label: '主屏幕 (1)',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    primary: true
  }
];

describe('OBSMonitor test alert', () => {
  it('emits a test alert and restores the previous snapshot after action', async () => {
    const monitor = new OBSMonitor(config, displays);
    let alerts = 0;
    monitor.on('alert', () => {
      alerts += 1;
    });

    const before = monitor.getSnapshot();
    const alertSnapshot = monitor.triggerTestAlert();

    expect(alerts).toBe(1);
    expect(alertSnapshot.alertVisible).toBe(true);
    expect(alertSnapshot.status).toBe('alerting');
    expect(alertSnapshot.config.targetInputName).toBe('Mic');

    const after = monitor.handleAlertAction('acknowledge');
    expect(after.alertVisible).toBe(before.alertVisible);
    expect(after.connected).toBe(before.connected);
    expect(after.status).toBe(before.status);
    expect(after.inputs).toEqual(before.inputs);

    await monitor.stop();
  });

  it('can temporarily simulate live output for local testing', async () => {
    const monitor = new OBSMonitor(config, displays);

    const simulated = monitor.setSimulatedLive(true);
    expect(simulated.simulatedLive).toBe(true);
    expect(simulated.streaming).toBe(true);
    expect(simulated.status).toBe('disconnected');

    const stopped = monitor.setSimulatedLive(false);
    expect(stopped.simulatedLive).toBe(false);
    expect(stopped.streaming).toBe(false);

    await monitor.stop();
  });

  it('only establishes speaking after the meter crosses the configured threshold', async () => {
    const monitor = new OBSMonitor(config, displays);
    const internals = monitor as unknown as {
      state: { connected: boolean; streaming: boolean };
      ensureInputState: (name: string, kind: string) => unknown;
      updateInputLevel: (state: unknown, levelDb: number, now: number) => void;
      recomputeAggregateState: (now: number) => void;
    };
    const input = internals.ensureInputState('Mic', 'wasapi_input_capture');
    internals.state.connected = true;
    internals.state.streaming = true;
    const now = Date.now();

    internals.updateInputLevel(input, -70, now);
    internals.recomputeAggregateState(now);
    expect(monitor.getSnapshot(now).audioSpeaking).toBe(false);

    internals.updateInputLevel(input, -30, now + 1000);
    internals.recomputeAggregateState(now + 1000);
    expect(monitor.getSnapshot(now + 1000).audioSpeaking).toBe(false);

    internals.updateInputLevel(input, -30, now + 1130);
    internals.recomputeAggregateState(now + 1130);
    expect(monitor.getSnapshot(now + 1130).audioSpeaking).toBe(true);

    internals.updateInputLevel(input, -70, now + 1500);
    internals.recomputeAggregateState(now + 1500);
    expect(monitor.getSnapshot(now + 1500).audioSpeaking).toBe(true);

    internals.recomputeAggregateState(now + 4500);
    expect(monitor.getSnapshot(now + 4500).audioSpeaking).toBe(false);
    await monitor.stop();
  });

  it('opens a windowed OBS program projector only while connected', async () => {
    const monitor = new OBSMonitor(config, displays);
    const call = vi.fn().mockResolvedValue({});
    const internals = monitor as unknown as {
      obs: { call: typeof call } | null;
      state: { connected: boolean };
    };
    await expect(monitor.openProgramProjector()).rejects.toThrow('尚未连接');
    internals.obs = { call };
    internals.state.connected = true;

    await monitor.openProgramProjector();
    expect(call).toHaveBeenCalledWith('OpenVideoMixProjector', {
      videoMixType: 'OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM',
      monitorIndex: -1
    });
  });
});
