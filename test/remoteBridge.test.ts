import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LAN_REMOTE_SERVER_URL,
  PUBLIC_REMOTE_SERVER_URL,
  proxyDirectiveUrl,
  publicPairUrl,
  recentRuntimeError,
  remoteAudioTelemetry,
  remoteRouteType,
  remoteServerCandidates,
  resolveServerRoomName
} from '../src/main/RemoteBridge.js';
import type { AppSnapshot } from '../src/shared/types.js';

describe('remote server selection', () => {
  it('prefers the LAN route and falls back to public HTTPS for the built-in service', () => {
    expect(remoteServerCandidates(LAN_REMOTE_SERVER_URL)).toEqual([
      LAN_REMOTE_SERVER_URL,
      PUBLIC_REMOTE_SERVER_URL
    ]);
    expect(remoteServerCandidates(PUBLIC_REMOTE_SERVER_URL)).toEqual([
      LAN_REMOTE_SERVER_URL,
      PUBLIC_REMOTE_SERVER_URL
    ]);
  });

  it('does not rewrite a custom remote server', () => {
    expect(remoteServerCandidates('https://remote.example.com/control/')).toEqual([
      'https://remote.example.com/control'
    ]);
  });

  it('labels LAN, public and custom service routes', () => {
    expect(remoteRouteType(LAN_REMOTE_SERVER_URL)).toBe('lan');
    expect(remoteRouteType(PUBLIC_REMOTE_SERVER_URL)).toBe('public');
    expect(remoteRouteType('https://remote.example.com')).toBe('custom');
  });

  it('rewrites a cached LAN pairing link to the public HTTPS endpoint', () => {
    expect(publicPairUrl(`${LAN_REMOTE_SERVER_URL}/pair/example-token`)).toBe(
      `${PUBLIC_REMOTE_SERVER_URL}/pair/example-token`
    );
    expect(publicPairUrl('https://remote.example.com/pair/example-token')).toBe(
      'https://remote.example.com/pair/example-token'
    );
  });
});

describe('remote service reconnect pacing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('backs off repeated reconnects and resets during lifecycle cleanup', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bridge = new (await import('../src/main/RemoteBridge.js')).RemoteBridge();
    const internal = bridge as unknown as {
      enabled: boolean;
      reconnectAttempt: number;
      reconnectTimer: NodeJS.Timeout | null;
      connect: (generation: number) => Promise<void>;
      scheduleReconnect: (generation: number) => void;
      clearTimers: () => void;
    };
    internal.enabled = true;
    internal.connect = vi.fn(async () => undefined);

    internal.scheduleReconnect(1);
    expect(internal.reconnectAttempt).toBe(1);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(internal.connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(internal.connect).toHaveBeenCalledTimes(1);

    internal.scheduleReconnect(1);
    expect(internal.reconnectAttempt).toBe(2);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(internal.connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(internal.connect).toHaveBeenCalledTimes(2);

    internal.clearTimers();
    expect(internal.reconnectAttempt).toBe(0);
    expect(internal.reconnectTimer).toBeNull();
  });
});

describe('remote runtime diagnostics', () => {
  it('stops reporting stale client errors after seven days', () => {
    const error = { code: 'renderer_gone', source: 'floating', message: 'crashed', occurredAt: 1000, count: 1 };
    expect(recentRuntimeError(error, 2000)).toEqual(error);
    expect(recentRuntimeError(error, 1000 + 7 * 24 * 60 * 60 * 1000 + 1)).toBeNull();
  });
});

describe('livestream room name synchronization', () => {
  it('accepts a newer server name and persists the server revision', () => {
    expect(resolveServerRoomName('旧名称', 2, ' 新名称 ', 3)).toEqual({
      roomName: '新名称',
      revision: 3
    });
  });

  it('keeps a newer local edit when an older server response arrives', () => {
    expect(resolveServerRoomName('本地新名称', 4, '服务器旧名称', 3)).toBeNull();
  });

  it('lets the server resolve an equal-revision conflict', () => {
    expect(resolveServerRoomName('本地名称', 5, '后台名称', 5)).toEqual({
      roomName: '后台名称',
      revision: 5
    });
  });
});

describe('system proxy routing', () => {
  it('uses the first supported proxy directive', () => {
    expect(proxyDirectiveUrl('PROXY 127.0.0.1:7890; DIRECT')).toBe('http://127.0.0.1:7890');
    expect(proxyDirectiveUrl('SOCKS5 127.0.0.1:1080; DIRECT')).toBe('socks5://127.0.0.1:1080');
  });

  it('keeps direct connections agent-free', () => {
    expect(proxyDirectiveUrl('DIRECT')).toBeNull();
  });
});

describe('remote audio telemetry', () => {
  const snapshot = (patch: Partial<AppSnapshot>): AppSnapshot => ({
    connected: true,
    monitoringActive: true,
    streaming: true,
    recording: false,
    simulatedLive: false,
    virtualCameraActive: false,
    activeInputName: '麦克风/Aux',
    lastLevelDb: null,
    lastAudioMeterReceivedAt: null,
    audioSpeaking: false,
    silentForSeconds: 0,
    alertVisible: false,
    activeAlertSource: null,
    readinessReason: 'no_target_meter',
    config: {
      targetInputNames: ['麦克风/Aux'],
      targetInputName: '麦克风/Aux',
      silenceThresholdDb: -55,
      silenceDurationSeconds: 120
    },
    ...patch
  } as AppSnapshot);

  it('keeps missing meter data out of the speaking state', () => {
    const audio = remoteAudioTelemetry(snapshot({}), 10_000);
    expect(audio.ready).toBe(false);
    expect(audio.phase).toBe('idle');
    expect(audio.levelDb).toBeNull();
    expect(audio.display).toBe('等待音频数据');
    expect(audio.hint).toBe('尚未收到 OBS 电平数据');
  });

  it('shows speaking only while monitoring with a fresh valid meter', () => {
    const audio = remoteAudioTelemetry(snapshot({
      lastLevelDb: -21.5,
      lastAudioMeterReceivedAt: 9_500,
      audioSpeaking: true,
      readinessReason: 'ready'
    }), 10_000);
    expect(audio.ready).toBe(true);
    expect(audio.phase).toBe('speaking');
    expect(audio.levelDb).toBe(-21.5);
    expect(audio.display).toBe('正在讲话');
    expect(audio.meterAgeMs).toBe(500);
  });

  it('keeps silence state separate from the gradual warning color', () => {
    const audio = remoteAudioTelemetry(snapshot({
      lastLevelDb: -72,
      lastAudioMeterReceivedAt: 9_500,
      audioSpeaking: false,
      silentForSeconds: 8,
      readinessReason: 'ready'
    }), 10_000);
    expect(audio.ready).toBe(true);
    expect(audio.phase).toBe('silent');
    expect(audio.tone).toBe('safe');
    expect(audio.display).toBe('8s');
  });

  it('uses the shared two-minute duration and gradually warms from 25 percent', () => {
    const firstQuarter = remoteAudioTelemetry(snapshot({
      lastLevelDb: -72,
      lastAudioMeterReceivedAt: 9_500,
      silentForSeconds: 30,
      readinessReason: 'ready'
    }), 10_000);
    const halfway = remoteAudioTelemetry(snapshot({
      lastLevelDb: -72,
      lastAudioMeterReceivedAt: 9_500,
      silentForSeconds: 60,
      readinessReason: 'ready'
    }), 10_000);

    expect(firstQuarter.silenceDurationSeconds).toBe(120);
    expect(firstQuarter.warningProgress).toBe(0);
    expect(halfway.warningProgress).toBeGreaterThan(0);
    expect(halfway.warningProgress).toBeLessThan(1);
    expect(halfway.tone).toBe('warning');
  });

  it('turns red near the end of the shared countdown', () => {
    const audio = remoteAudioTelemetry(snapshot({
      lastLevelDb: -72,
      lastAudioMeterReceivedAt: 9_500,
      silentForSeconds: 109,
      readinessReason: 'ready'
    }), 10_000);

    expect(audio.tone).toBe('danger');
    expect(audio.dangerProgress).toBeGreaterThan(0);
  });

  it('marks an old meter chain as interrupted instead of reusing its level', () => {
    const audio = remoteAudioTelemetry(snapshot({
      lastLevelDb: -18,
      lastAudioMeterReceivedAt: 1_000,
      readinessReason: 'ready'
    }), 10_000);
    expect(audio.ready).toBe(false);
    expect(audio.levelDb).toBeNull();
    expect(audio.display).toBe('等待音频数据');
    expect(audio.hint).toBe('音频电平链路已中断');
    expect(audio.meterAgeMs).toBe(9000);
  });

  it('does not expose a camera alarm as an audio alarm on the mobile monitor', () => {
    const audio = remoteAudioTelemetry(snapshot({
      lastLevelDb: -23,
      lastAudioMeterReceivedAt: 9_500,
      audioSpeaking: true,
      alertVisible: true,
      activeAlertSource: 'atem_camera',
      readinessReason: 'ready'
    }), 10_000);

    expect(audio.phase).toBe('speaking');
    expect(audio.tone).toBe('safe');
    expect(audio.display).toBe('正在讲话');
  });
});
