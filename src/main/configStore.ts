import { app, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_CONFIG, type AlertDisplayMode, type AlertPosition, type AppConfig, type WindowBounds } from '../shared/types.js';

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
    return this.save({
      ...DEFAULT_CONFIG,
      alertPositions: {},
      floatingWindowBounds: null
    });
  }

  private normalize(config: AppConfig): AppConfig {
    const merged = {
      ...DEFAULT_CONFIG,
      ...config
    };

    return {
      ...merged,
      obsHost: stringValue(merged.obsHost, DEFAULT_CONFIG.obsHost).trim() || DEFAULT_CONFIG.obsHost,
      obsPort: clamp(Math.round(numberValue(merged.obsPort, DEFAULT_CONFIG.obsPort)), 1, 65535),
      obsPassword: stringValue(merged.obsPassword, ''),
      targetInputName: stringValue(merged.targetInputName, '').trim(),
      silenceDurationSeconds: clamp(Math.round(numberValue(merged.silenceDurationSeconds, DEFAULT_CONFIG.silenceDurationSeconds)), 5, 60 * 60),
      silenceThresholdDb: clamp(numberValue(merged.silenceThresholdDb, DEFAULT_CONFIG.silenceThresholdDb), -90, -5),
      alertDisplayMode: alertDisplayModeValue(merged.alertDisplayMode),
      alertDisplayId: nullableIntegerValue(merged.alertDisplayId),
      paused: booleanValue(merged.paused, DEFAULT_CONFIG.paused),
      hasSeenGuide: booleanValue(merged.hasSeenGuide, DEFAULT_CONFIG.hasSeenGuide),
      preAlertEnabled: booleanValue(merged.preAlertEnabled, DEFAULT_CONFIG.preAlertEnabled),
      preAlertRatio: clamp(numberValue(merged.preAlertRatio, DEFAULT_CONFIG.preAlertRatio), 0.1, 0.95),
      rememberAlertPosition: booleanValue(merged.rememberAlertPosition, DEFAULT_CONFIG.rememberAlertPosition),
      alertPositions: alertPositionsValue(merged.alertPositions),
      floatingWindowEnabled: booleanValue(merged.floatingWindowEnabled, DEFAULT_CONFIG.floatingWindowEnabled),
      floatingWindowBounds: windowBoundsValue(merged.floatingWindowBounds),
      autoLaunch: booleanValue(merged.autoLaunch, DEFAULT_CONFIG.autoLaunch)
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

function alertDisplayModeValue(value: unknown): AlertDisplayMode {
  return value === 'primary' || value === 'display_id' || value === 'all' ? value : DEFAULT_CONFIG.alertDisplayMode;
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
    width: clamp(Math.round(raw.width as number), 320, 560),
    height: clamp(Math.round(raw.height as number), 150, 320)
  };
}
