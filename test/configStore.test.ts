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
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
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
    expect(saved.floatingWindowBounds).toEqual({ x: 5, y: 9, width: 320, height: 320 });
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

    const reset = await store.reset();

    expect(reset).toEqual(DEFAULT_CONFIG);
  });
});
