import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '../src/shared/types.js';

const electronMock = vi.hoisted(() => ({
  userData: `${process.env.TMPDIR ?? process.env.TEMP ?? '.'}/obs-audio-assistant-config-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.userData
  },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value: string) => Buffer.from(value, 'utf8'),
    decryptStringAsync: async (value: Buffer) => ({ result: value.toString('utf8'), shouldReEncrypt: false })
  }
}));

const { ConfigStore } = await import('../src/main/configStore.js');

afterAll(() => {
  rmSync(electronMock.userData, { recursive: true, force: true });
});

describe('ConfigStore', () => {
  it('normalizes unsafe numeric and display values before saving', async () => {
    const store = new ConfigStore();
    const saved = await store.save({
      ...DEFAULT_CONFIG,
      obsPort: 0,
      silenceDurationSeconds: Number.NaN,
      silenceThresholdDb: Number.NaN,
      preAlertRatio: Number.NaN,
      alertDisplayMode: 'missing-mode',
      alertDisplayId: Number.NaN,
      alertPositions: {
        1: { x: 12.7, y: 48.2 },
        bad: { x: Number.NaN, y: 10 }
      },
      floatingWindowEnabled: 'yes',
      floatingWindowBounds: { x: 5.4, y: 8.6, width: 100, height: 999 }
    } as unknown as AppConfig);

    expect(saved.obsPort).toBe(1);
    expect(saved.silenceDurationSeconds).toBe(DEFAULT_CONFIG.silenceDurationSeconds);
    expect(saved.silenceThresholdDb).toBe(DEFAULT_CONFIG.silenceThresholdDb);
    expect(saved.preAlertRatio).toBe(DEFAULT_CONFIG.preAlertRatio);
    expect(saved.alertDisplayMode).toBe(DEFAULT_CONFIG.alertDisplayMode);
    expect(saved.alertDisplayId).toBeNull();
    expect(saved.alertPositions).toEqual({ 1: { x: 13, y: 48 } });
    expect(saved.floatingWindowEnabled).toBe(false);
    expect(saved.floatingWindowBounds).toEqual({ x: 5, y: 9, width: 320, height: 520 });
  });

  it('trims text fields and clamps the OBS port range', async () => {
    const store = new ConfigStore();
    const saved = await store.save({
      ...DEFAULT_CONFIG,
      obsHost: '',
      targetInputName: '  Mic  ',
      obsPort: 70_000
    });

    expect(saved.obsHost).toBe(DEFAULT_CONFIG.obsHost);
    expect(saved.targetInputName).toBe('Mic');
    expect(saved.obsPort).toBe(65_535);
  });

  it('persists the configured silence duration across reloads', async () => {
    const store = new ConfigStore();
    await store.save({
      ...DEFAULT_CONFIG,
      silenceDurationSeconds: 300
    });

    const reloaded = await new ConfigStore().load();

    expect(reloaded.silenceDurationSeconds).toBe(300);
  });

  it('securely persists the OBS password only when requested', async () => {
    const store = new ConfigStore();
    await store.save({ ...DEFAULT_CONFIG, obsPassword: 'secret-value', rememberObsPassword: true });
    expect((await new ConfigStore().load()).obsPassword).toBe('secret-value');

    await store.save({ ...DEFAULT_CONFIG, obsPassword: 'session-only', rememberObsPassword: false });
    const sessionOnlyReload = await new ConfigStore().load();
    expect(sessionOnlyReload.obsPassword).toBe('');
    expect(sessionOnlyReload.rememberObsPassword).toBe(false);
  });

  it('migrates legacy ATEM defaults to ten minutes and preserves the combined floating mode', async () => {
    const store = new ConfigStore();
    await store.save({
      ...DEFAULT_CONFIG,
      floatingWindowMode: 'audio_atem',
      atemCameraTimeLimitSeconds: 180
    });

    const reloaded = await new ConfigStore().load();

    expect(reloaded.floatingWindowMode).toBe('audio_atem');
    expect(reloaded.atemCameraTimeLimitSeconds).toBe(600);

    await store.save({
      ...DEFAULT_CONFIG,
      atemCameraTimeLimitSeconds: 300
    });
    expect((await new ConfigStore().load()).atemCameraTimeLimitSeconds).toBe(600);
  });

  it('restores defaults and marks the guide as unseen', async () => {
    const store = new ConfigStore();
    await store.save({
      ...DEFAULT_CONFIG,
      targetInputName: 'Mic',
      hasSeenGuide: true,
      floatingWindowEnabled: true,
      floatingWindowBounds: { x: 20, y: 30, width: 420, height: 220 },
      alertPositions: {
        1: { x: 100, y: 200 }
      }
    });

    const beforeReset = await store.load();
    const reset = await store.reset();

    expect(reset).toEqual({
      ...DEFAULT_CONFIG,
      remoteDeviceUuid: beforeReset.remoteDeviceUuid,
      remoteDeviceSecret: beforeReset.remoteDeviceSecret
    });
    expect(reset.remoteDeviceUuid).toMatch(/^[0-9a-f-]{20,64}$/i);
    expect(reset.remoteDeviceSecret).toMatch(/^[0-9a-f]{64,128}$/i);
  });

  it('serializes concurrent patches without losing an earlier setting', async () => {
    const store = new ConfigStore();
    await store.save(DEFAULT_CONFIG);

    await Promise.all([
      store.update({ silenceDurationSeconds: 240 }),
      store.update({ silenceThresholdDb: -48 })
    ]);

    const reloaded = await new ConfigStore().load();
    expect(reloaded.silenceDurationSeconds).toBe(240);
    expect(reloaded.silenceThresholdDb).toBe(-48);
  });
});
