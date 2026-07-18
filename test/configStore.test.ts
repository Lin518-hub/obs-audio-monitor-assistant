import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '../src/shared/types.js';

const electronMock = vi.hoisted(() => ({
  userData: `${process.env.TMPDIR ?? process.env.TEMP ?? '.'}/obs-audio-assistant-config-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
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
      developerModeEnabled: 'yes',
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
    expect(saved.developerModeEnabled).toBe(false);
    expect(saved.floatingWindowBounds).toEqual({ x: 5, y: 9, width: 170, height: 520 });
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

  it('persists developer mode until it is explicitly disabled', async () => {
    const store = new ConfigStore();
    await store.save({
      ...DEFAULT_CONFIG,
      developerModeEnabled: true
    });

    expect((await new ConfigStore().load()).developerModeEnabled).toBe(true);

    await store.update({ developerModeEnabled: false });
    expect((await new ConfigStore().load()).developerModeEnabled).toBe(false);
  });

  it('enables automatic updates when loading a legacy config without the setting', async () => {
    mkdirSync(electronMock.userData, { recursive: true });
    const { autoUpdateEnabled: _removed, ...legacyConfig } = DEFAULT_CONFIG;
    writeFileSync(join(electronMock.userData, 'config.json'), JSON.stringify(legacyConfig));

    const migrated = await new ConfigStore().load();

    expect(migrated.autoUpdateEnabled).toBe(true);
  });

  it('normalizes and persists the developer-only preflight checklist', async () => {
    const store = new ConfigStore();
    const saved = await store.save({
      ...DEFAULT_CONFIG,
      preflightApps: {
        ...DEFAULT_CONFIG.preflightApps,
        obs: { enabled: false, path: '  C:\\Live\\OBS.lnk  ' },
        douyin: { enabled: 'yes', path: 42 }
      }
    } as unknown as AppConfig);

    expect(saved.preflightApps.obs).toEqual({
      enabled: false,
      path: 'C:\\Live\\OBS.lnk',
      restoreWindowPosition: true,
      pathSource: 'unknown',
      customLabel: '',
      launchUrl: ''
    });
    expect(saved.preflightApps.douyin).toEqual(DEFAULT_CONFIG.preflightApps.douyin);
    expect((await new ConfigStore().load()).preflightApps.obs.path).toBe('C:\\Live\\OBS.lnk');
  });

  it('clears legacy preflight settings once and preserves later configuration', async () => {
    const { preflightConfigRevision: _removed, ...legacyConfig } = DEFAULT_CONFIG;
    mkdirSync(electronMock.userData, { recursive: true });
    writeFileSync(join(electronMock.userData, 'config.json'), JSON.stringify({
      ...legacyConfig,
      silenceDurationSeconds: 360,
      preflightApps: {
        ...DEFAULT_CONFIG.preflightApps,
        obs: { ...DEFAULT_CONFIG.preflightApps.obs, path: 'C:\\Old\\OBS.lnk', enabled: false },
        browser: { ...DEFAULT_CONFIG.preflightApps.browser, path: 'C:\\Old\\Browser.exe', launchUrl: 'https://old.example.com' }
      },
      preflightProjector: { enabled: true, restoreWindowPosition: false },
      preflightWindowPlacements: {
        obs: {
          displayId: 1,
          displayLabel: '旧显示器',
          capturedWorkArea: { x: 0, y: 0, width: 1920, height: 1080 },
          normalizedBounds: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
          windowState: 'normal',
          capturedAt: 1
        }
      }
    }));

    const migrated = await new ConfigStore().load();
    expect(migrated.preflightApps).toEqual(DEFAULT_CONFIG.preflightApps);
    expect(migrated.preflightProjector).toEqual(DEFAULT_CONFIG.preflightProjector);
    expect(migrated.preflightWindowPlacements).toEqual({});
    expect(migrated.preflightConfigRevision).toBe(DEFAULT_CONFIG.preflightConfigRevision);
    expect(migrated.silenceDurationSeconds).toBe(360);

    await new ConfigStore().save({
      ...migrated,
      preflightApps: {
        ...migrated.preflightApps,
        obs: { ...migrated.preflightApps.obs, path: 'C:\\New\\OBS.lnk' }
      }
    });
    expect((await new ConfigStore().load()).preflightApps.obs.path).toBe('C:\\New\\OBS.lnk');
  });

  it('migrates preflight projector and saved window placement settings', async () => {
    const store = new ConfigStore();
    const saved = await store.save({
      ...DEFAULT_CONFIG,
      preflightProjector: { enabled: true, restoreWindowPosition: true },
      preflightWindowPlacements: {
        obs: {
          displayId: 4,
          displayLabel: 'Studio',
          capturedWorkArea: { x: 0, y: 0, width: 1920, height: 1040 },
          normalizedBounds: { x: .1, y: .2, width: .6, height: .7 },
          windowState: 'maximized',
          capturedAt: 1234
        },
        cosmic_cat: {
          displayId: 2,
          displayLabel: 'Unused',
          capturedWorkArea: { x: 0, y: 0, width: 1920, height: 1040 },
          normalizedBounds: { x: .1, y: .1, width: .5, height: .5 },
          windowState: 'normal',
          capturedAt: 1234
        }
      },
      preflightApps: {
        ...DEFAULT_CONFIG.preflightApps,
        cosmic_cat: { ...DEFAULT_CONFIG.preflightApps.cosmic_cat, restoreWindowPosition: true },
        browser: {
          ...DEFAULT_CONFIG.preflightApps.browser,
          launchUrl: ' https://example.com/live ',
          pathSource: 'registry'
        }
      }
    });

    expect(saved.preflightProjector.enabled).toBe(true);
    expect(saved.preflightApps.browser.launchUrl).toBe('https://example.com/live');
    expect(saved.preflightApps.browser.pathSource).toBe('registry');
    expect(saved.preflightApps.cosmic_cat.restoreWindowPosition).toBe(false);
    expect(saved.preflightWindowPlacements.obs?.windowState).toBe('maximized');
    expect(saved.preflightWindowPlacements.cosmic_cat).toBeUndefined();
  });

  it('normalizes custom ATEM names, colors and groups', async () => {
    const store = new ConfigStore();
    const saved = await store.save({
      ...DEFAULT_CONFIG,
      atemInputCustomizations: {
        1: { name: '  主播近景  ', color: '#12ab34', group: '  主播组  ' },
        invalid: { name: '不会保存', color: '#fff', group: '测试' }
      }
    });

    expect(saved.atemInputCustomizations).toEqual({
      1: { name: '主播近景', color: '#12AB34', group: '主播组' }
    });
  });

  it('migrates the previous shared green ATEM default to distinct Morandi colors', async () => {
    const store = new ConfigStore();
    const saved = await store.save({
      ...DEFAULT_CONFIG,
      atemInputCustomizations: {
        1: { name: '一号机', color: '#22C55E', group: '主播组' },
        2: { name: '二号机', color: '#22C55E', group: '主播组' }
      }
    });

    expect(saved.atemInputCustomizations['1'].color).not.toBe('#22C55E');
    expect(saved.atemInputCustomizations['2'].color).not.toBe('#22C55E');
    expect(saved.atemInputCustomizations['1'].color).not.toBe(saved.atemInputCustomizations['2'].color);
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

  it('resets the legacy wide audio and ATEM bounds to the compact preview size', async () => {
    mkdirSync(electronMock.userData, { recursive: true });
    writeFileSync(join(electronMock.userData, 'config.json'), JSON.stringify({
      ...DEFAULT_CONFIG,
      floatingWindowMode: 'audio_atem',
      floatingWindowLayoutVersion: 1,
      floatingWindowBounds: { x: 120, y: 90, width: 400, height: 292 }
    }));

    const migrated = await new ConfigStore().load();

    expect(migrated.floatingWindowLayoutVersion).toBe(DEFAULT_CONFIG.floatingWindowLayoutVersion);
    expect(migrated.floatingWindowBounds).toBeNull();
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
