import { describe, expect, it } from 'vitest';
import {
  LAN_REMOTE_SERVER_URL,
  PUBLIC_REMOTE_SERVER_URL,
  proxyDirectiveUrl,
  publicPairUrl,
  remoteAudioTelemetry,
  remoteRouteType,
  remoteServerCandidates
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
    streaming: true,
    recording: false,
    simulatedLive: false,
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
