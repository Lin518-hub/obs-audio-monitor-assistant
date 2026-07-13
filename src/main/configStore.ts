import { app, safeStorage } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_CONFIG, type AlertDisplayMode, type AlertPosition, type AlertReminderMode, type AlertSoundPreset, type AppConfig, type FloatingWindowMode, type UpdateSource, type WindowBounds } from '../shared/types.js';

interface PersistedConfig extends Omit<AppConfig, 'obsPassword'> {
  obsPasswordEncrypted?: string;
}

export class ConfigStore {
  private readonly path = join(app.getPath('userData'), 'config.json');

  async load(): Promise<AppConfig> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedConfig>;
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        ...parsed,
        obsPassword: this.decryptPassword(parsed.obsPasswordEncrypted)
      };

      // 180 seconds was the previous built-in default. Move untouched legacy
      // installations to the new five-minute default while preserving every
      // other custom duration.
      if (parsed.atemCameraTimeLimitSeconds === 180) {
        config.atemCameraTimeLimitSeconds = DEFAULT_CONFIG.atemCameraTimeLimitSeconds;
      }

      return this.normalize(config);
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  async save(config: AppConfig): Promise<AppConfig> {
    const normalized = this.normalize(config);
    const persisted: PersistedConfig = {
      ...normalized,
      obsPasswordEncrypted: this.encryptPassword(normalized.obsPassword)
    };
    delete (persisted as Partial<AppConfig>).obsPassword;

    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
    return normalized;
  }

  async reset(): Promise<AppConfig> {
    const current = await this.load();
    return this.save({
      ...DEFAULT_CONFIG,
      alertPositions: {},
      floatingWindowBounds: null,
      remoteDeviceUuid: current.remoteDeviceUuid,
      remoteDeviceSecret: current.remoteDeviceSecret
    });
  }

  private normalize(config: AppConfig): AppConfig {
    const merged = {
      ...DEFAULT_CONFIG,
      ...config
    };

    const targetInputName = stringValue(merged.targetInputName, '').trim();
    const targetInputNames = stringArrayValue(merged.targetInputNames);
    const migratedTargets = targetInputNames.length > 0
      ? targetInputNames
      : targetInputName
        ? [targetInputName]
        : [];

    const floatingWindowModules = floatingWindowModulesValue(merged.floatingWindowModules);
    const remoteDeviceUuid = uuidValue(merged.remoteDeviceUuid) || randomUUID();
    const remoteDeviceSecret = secretValue(merged.remoteDeviceSecret) || randomBytes(32).toString('hex');

    return {
      ...merged,
      obsHost: stringValue(merged.obsHost, DEFAULT_CONFIG.obsHost).trim() || DEFAULT_CONFIG.obsHost,
      obsPort: clamp(Math.round(numberValue(merged.obsPort, DEFAULT_CONFIG.obsPort)), 1, 65535),
      obsPassword: stringValue(merged.obsPassword, ''),
      targetInputName: targetInputName || migratedTargets[0] || '',
      targetInputNames: migratedTargets,
      silenceDurationSeconds: clamp(Math.round(numberValue(merged.silenceDurationSeconds, DEFAULT_CONFIG.silenceDurationSeconds)), 5, 60 * 60),
      silenceThresholdDb: clamp(numberValue(merged.silenceThresholdDb, DEFAULT_CONFIG.silenceThresholdDb), -90, -5),
      alertDisplayMode: alertDisplayModeValue(merged.alertDisplayMode),
      alertDisplayId: nullableIntegerValue(merged.alertDisplayId),
      alertReminderMode: alertReminderModeValue(merged.alertReminderMode),
      alertSoundEnabled: booleanValue(merged.alertSoundEnabled, DEFAULT_CONFIG.alertSoundEnabled),
      alertSoundPreset: alertSoundPresetValue(merged.alertSoundPreset),
      paused: booleanValue(merged.paused, DEFAULT_CONFIG.paused),
      hasSeenGuide: booleanValue(merged.hasSeenGuide, DEFAULT_CONFIG.hasSeenGuide),
      guideSeenVersion: stringValue(merged.guideSeenVersion, DEFAULT_CONFIG.guideSeenVersion).trim(),
      preAlertEnabled: booleanValue(merged.preAlertEnabled, DEFAULT_CONFIG.preAlertEnabled),
      preAlertRatio: clamp(numberValue(merged.preAlertRatio, DEFAULT_CONFIG.preAlertRatio), 0.1, 0.95),
      rememberAlertPosition: booleanValue(merged.rememberAlertPosition, DEFAULT_CONFIG.rememberAlertPosition),
      alertPositions: alertPositionsValue(merged.alertPositions),
      floatingWindowEnabled: booleanValue(merged.floatingWindowEnabled, DEFAULT_CONFIG.floatingWindowEnabled),
      floatingWindowMode: floatingWindowModeValue(merged.floatingWindowMode, floatingWindowModules),
      floatingWindowBounds: windowBoundsValue(merged.floatingWindowBounds),
      floatingWindowModules,
      remoteAccessEnabled: booleanValue(merged.remoteAccessEnabled, DEFAULT_CONFIG.remoteAccessEnabled),
      remoteServerUrl: serverUrlValue(merged.remoteServerUrl),
      remoteDeviceUuid,
      remoteDeviceSecret,
      autoLaunch: booleanValue(merged.autoLaunch, DEFAULT_CONFIG.autoLaunch),
      updateSource: updateSourceValue(merged.updateSource),
      aliyunUpdateBaseUrl: normalizeUpdateBaseUrl(merged.aliyunUpdateBaseUrl),
      atemEnabled: booleanValue(merged.atemEnabled, DEFAULT_CONFIG.atemEnabled),
      atemHost: stringValue(merged.atemHost, DEFAULT_CONFIG.atemHost).trim() || DEFAULT_CONFIG.atemHost,
      atemHotkeyGlobal: booleanValue(merged.atemHotkeyGlobal, DEFAULT_CONFIG.atemHotkeyGlobal),
      atemHardCutConfirm: booleanValue(merged.atemHardCutConfirm, DEFAULT_CONFIG.atemHardCutConfirm),
      atemCameraTimeAlertEnabled: booleanValue(merged.atemCameraTimeAlertEnabled, DEFAULT_CONFIG.atemCameraTimeAlertEnabled),
      atemCameraTimeLimitSeconds: clamp(Math.round(numberValue(merged.atemCameraTimeLimitSeconds, DEFAULT_CONFIG.atemCameraTimeLimitSeconds)), 10, 60 * 60)
    };
  }

  private encryptPassword(password: string): string {
    if (!password) {
      return '';
    }

    if (safeStorage.isEncryptionAvailable()) {
      return `safe:${safeStorage.encryptString(password).toString('base64')}`;
    }

    return `plain:${Buffer.from(password, 'utf8').toString('base64')}`;
  }

  private decryptPassword(value: string | undefined): string {
    if (!value) {
      return '';
    }

    try {
      if (value.startsWith('safe:') && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(value.slice(5), 'base64'));
      }

      if (value.startsWith('plain:')) {
        return Buffer.from(value.slice(6), 'base64').toString('utf8');
      }
    } catch {
      return '';
    }

    return '';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableIntegerValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .map((item) => stringValue(item, '').trim())
      .filter(Boolean)
  ));
}

function alertDisplayModeValue(value: unknown): AlertDisplayMode {
  return value === 'primary' || value === 'display_id' || value === 'all' ? value : DEFAULT_CONFIG.alertDisplayMode;
}

function alertReminderModeValue(value: unknown): AlertReminderMode {
  if (value === 'toast' || value === 'both' || value === 'fullscreen') {
    return 'fullscreen';
  }
  return value === 'classic' ? value : DEFAULT_CONFIG.alertReminderMode;
}

function alertSoundPresetValue(value: unknown): AlertSoundPreset {
  return value === 'clear' || value === 'strong' || value === 'low' || value === 'soft'
    ? value
    : DEFAULT_CONFIG.alertSoundPreset;
}

function floatingWindowModeValue(value: unknown, modules: AppConfig['floatingWindowModules']): FloatingWindowMode {
  if (value === 'multifunction') {
    return 'multifunction';
  }
  if (value === 'audio_atem') {
    return 'audio_atem';
  }
  if (value === 'audio') {
    return 'audio';
  }

  // Existing versions used the module switches as the implicit mode.
  return modules.atem || modules.obsStats ? 'multifunction' : DEFAULT_CONFIG.floatingWindowMode;
}

function updateSourceValue(value: unknown): UpdateSource {
  return value === 'auto' || value === 'github' || value === 'gh_proxy' || value === 'ghproxy_net' || value === 'aliyun' || value === 'lan'
    ? value
    : DEFAULT_CONFIG.updateSource;
}

function normalizeUpdateBaseUrl(value: unknown): string {
  const raw = stringValue(value, '').trim();
  if (!raw) {
    return '';
  }

  return raw.endsWith('/') ? raw : `${raw}/`;
}

function uuidValue(value: unknown): string {
  const raw = stringValue(value, '').trim();
  return /^[0-9a-f-]{20,64}$/i.test(raw) ? raw : '';
}

function secretValue(value: unknown): string {
  const raw = stringValue(value, '').trim();
  return /^[0-9a-f]{64,128}$/i.test(raw) ? raw : '';
}

function serverUrlValue(value: unknown): string {
  try {
    const url = new URL(stringValue(value, DEFAULT_CONFIG.remoteServerUrl).trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return DEFAULT_CONFIG.remoteServerUrl;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_CONFIG.remoteServerUrl;
  }
}

function alertPositionsValue(value: unknown): Record<string, AlertPosition> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const positions: Record<string, AlertPosition> = {};
  for (const [displayId, position] of Object.entries(value)) {
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      continue;
    }

    const raw = position as Partial<AlertPosition>;
    if (Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      positions[displayId] = {
        x: Math.round(raw.x as number),
        y: Math.round(raw.y as number)
      };
    }
  }

  return positions;
}

function windowBoundsValue(value: unknown): WindowBounds | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as Partial<WindowBounds>;
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.width) || !Number.isFinite(raw.height)) {
    return null;
  }

  return {
    x: Math.round(raw.x as number),
    y: Math.round(raw.y as number),
    width: clamp(Math.round(raw.width as number), 320, 640),
    height: clamp(Math.round(raw.height as number), 150, 520)
  };
}

function floatingWindowModulesValue(value: unknown): AppConfig['floatingWindowModules'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_CONFIG.floatingWindowModules;
  }

  const raw = value as Partial<AppConfig['floatingWindowModules']>;
  return {
    audio: booleanValue(raw.audio, DEFAULT_CONFIG.floatingWindowModules.audio),
    atem: booleanValue(raw.atem, DEFAULT_CONFIG.floatingWindowModules.atem),
    obsStats: booleanValue(raw.obsStats, DEFAULT_CONFIG.floatingWindowModules.obsStats)
  };
}
