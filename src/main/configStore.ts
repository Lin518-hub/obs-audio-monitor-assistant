import { app, safeStorage } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defaultATEMInputColor } from '../shared/atemPalette.js';
import { DEFAULT_CONFIG, PREFLIGHT_APP_IDS, type AlertDisplayMode, type AlertPosition, type AlertReminderMode, type AlertSoundPreset, type AppConfig, type ATEMInputCustomization, type FloatingWindowMode, type PreflightAppConfigs, type PreflightPathSource, type PreflightWindowPlacement, type PreflightWindowPlacements, type UpdateSource, type WindowBounds } from '../shared/types.js';

interface PersistedConfig extends Omit<AppConfig, 'obsPassword'> {
  obsPasswordEncrypted?: string;
}

export class ConfigStore {
  private readonly path = join(app.getPath('userData'), 'config.json');
  private currentConfig: AppConfig | null = null;
  private currentEncryptedPassword = '';
  private writeQueue: Promise<void> = Promise.resolve();

  async load(): Promise<AppConfig> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedConfig>;
      const rememberObsPassword = booleanValue(parsed.rememberObsPassword, DEFAULT_CONFIG.rememberObsPassword);
      this.currentEncryptedPassword = stringValue(parsed.obsPasswordEncrypted, '');
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        ...parsed,
        rememberObsPassword,
        obsPassword: rememberObsPassword ? await this.decryptPassword(parsed.obsPasswordEncrypted) : ''
      };

      // Move the two previous built-in defaults to the new ten-minute value.
      // Other custom durations remain untouched.
      if (parsed.atemCameraTimeLimitSeconds === 180 || parsed.atemCameraTimeLimitSeconds === 300) {
        config.atemCameraTimeLimitSeconds = DEFAULT_CONFIG.atemCameraTimeLimitSeconds;
      }

      // Reset saved bounds whenever the combined window's fixed layout changes.
      if (numberValue(parsed.floatingWindowLayoutVersion, 0) < DEFAULT_CONFIG.floatingWindowLayoutVersion && config.floatingWindowMode === 'audio_atem') {
        config.floatingWindowBounds = null;
        config.floatingWindowLayoutVersion = DEFAULT_CONFIG.floatingWindowLayoutVersion;
      }

      this.currentConfig = this.normalize(config);
      return this.currentConfig;
    } catch {
      this.currentConfig = this.normalize(DEFAULT_CONFIG);
      return this.currentConfig;
    }
  }

  save(config: AppConfig): Promise<AppConfig> {
    return this.enqueueWrite(() => config);
  }

  update(patch: Partial<AppConfig> | ((current: AppConfig) => Partial<AppConfig>)): Promise<AppConfig> {
    return this.enqueueWrite(() => {
      const current = this.currentConfig ?? DEFAULT_CONFIG;
      const resolvedPatch = typeof patch === 'function' ? patch(current) : patch;
      return { ...current, ...resolvedPatch };
    });
  }

  async reset(): Promise<AppConfig> {
    const current = this.currentConfig ?? await this.load();
    return this.save({
      ...DEFAULT_CONFIG,
      alertPositions: {},
      floatingWindowBounds: null,
      remoteDeviceUuid: current.remoteDeviceUuid,
      remoteDeviceSecret: current.remoteDeviceSecret
    });
  }

  private enqueueWrite(resolveConfig: () => AppConfig): Promise<AppConfig> {
    const operation = this.writeQueue.catch(() => undefined).then(async () => {
      const normalized = this.normalize(resolveConfig());
      const obsPasswordEncrypted = normalized.rememberObsPassword
        ? normalized.obsPassword === this.currentConfig?.obsPassword && this.currentEncryptedPassword
          ? this.currentEncryptedPassword
          : await this.encryptPassword(normalized.obsPassword)
        : '';
      const persisted: PersistedConfig = {
        ...normalized,
        obsPasswordEncrypted
      };
      delete (persisted as Partial<AppConfig>).obsPassword;

      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
      this.currentEncryptedPassword = obsPasswordEncrypted;
      this.currentConfig = normalized;
      return normalized;
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
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
      rememberObsPassword: booleanValue(merged.rememberObsPassword, DEFAULT_CONFIG.rememberObsPassword),
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
      floatingWindowLayoutVersion: clamp(Math.round(numberValue(merged.floatingWindowLayoutVersion, DEFAULT_CONFIG.floatingWindowLayoutVersion)), 1, DEFAULT_CONFIG.floatingWindowLayoutVersion),
      floatingWindowBounds: windowBoundsValue(merged.floatingWindowBounds),
      floatingWindowModules,
      remoteAccessEnabled: booleanValue(merged.remoteAccessEnabled, DEFAULT_CONFIG.remoteAccessEnabled),
      remoteServerUrl: serverUrlValue(merged.remoteServerUrl),
      remoteDeviceUuid,
      remoteDeviceSecret,
      developerModeEnabled: booleanValue(merged.developerModeEnabled, DEFAULT_CONFIG.developerModeEnabled),
      autoLaunch: booleanValue(merged.autoLaunch, DEFAULT_CONFIG.autoLaunch),
      updateSource: updateSourceValue(merged.updateSource),
      aliyunUpdateBaseUrl: normalizeUpdateBaseUrl(merged.aliyunUpdateBaseUrl),
      atemEnabled: booleanValue(merged.atemEnabled, DEFAULT_CONFIG.atemEnabled),
      atemHost: stringValue(merged.atemHost, DEFAULT_CONFIG.atemHost).trim() || DEFAULT_CONFIG.atemHost,
      atemHotkeyGlobal: booleanValue(merged.atemHotkeyGlobal, DEFAULT_CONFIG.atemHotkeyGlobal),
      atemHardCutConfirm: booleanValue(merged.atemHardCutConfirm, DEFAULT_CONFIG.atemHardCutConfirm),
      atemCameraTimeAlertEnabled: booleanValue(merged.atemCameraTimeAlertEnabled, DEFAULT_CONFIG.atemCameraTimeAlertEnabled),
      atemCameraTimeLimitSeconds: clamp(Math.round(numberValue(merged.atemCameraTimeLimitSeconds, DEFAULT_CONFIG.atemCameraTimeLimitSeconds)), 10, 60 * 60),
      atemInputCustomizations: atemInputCustomizationsValue(merged.atemInputCustomizations),
      preflightApps: preflightAppsValue(merged.preflightApps),
      preflightProjector: preflightProjectorValue(merged.preflightProjector),
      preflightWindowPlacements: preflightWindowPlacementsValue(merged.preflightWindowPlacements)
    };
  }

  private async encryptPassword(password: string): Promise<string> {
    if (!password) {
      return '';
    }

    try {
      if (app.isPackaged !== false && await safeStorage.isAsyncEncryptionAvailable()) {
        return `safe:${(await safeStorage.encryptStringAsync(password)).toString('base64')}`;
      }
    } catch {
      // Keep the password in memory for this run when the credential store is unavailable.
      return '';
    }

    return `plain:${Buffer.from(password, 'utf8').toString('base64')}`;
  }

  private async decryptPassword(value: string | undefined): Promise<string> {
    if (!value) {
      return '';
    }

    try {
      // Development Electron has a different macOS signing identity. Avoid a
      // misleading keychain prompt while preserving the encrypted value on disk.
      if (value.startsWith('safe:') && app.isPackaged !== false && await safeStorage.isAsyncEncryptionAvailable()) {
        return (await safeStorage.decryptStringAsync(Buffer.from(value.slice(5), 'base64'))).result;
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
    // The compact audio + ATEM layout is intentionally smaller than the
    // audio-only window. Per-mode limits are enforced by the main process.
    width: clamp(Math.round(raw.width as number), 170, 640),
    height: clamp(Math.round(raw.height as number), 120, 520)
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

function atemInputCustomizationsValue(value: unknown): Record<string, ATEMInputCustomization> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, ATEMInputCustomization> = {};
  for (const [inputId, customization] of Object.entries(value)) {
    if (!/^\d{1,5}$/.test(inputId) || !customization || typeof customization !== 'object' || Array.isArray(customization)) continue;
    const raw = customization as Partial<ATEMInputCustomization>;
    const name = stringValue(raw.name, '').trim().slice(0, 40);
    const group = stringValue(raw.group, '').trim().slice(0, 24);
    const defaultColor = defaultATEMInputColor(Number(inputId));
    const storedColor = stringValue(raw.color, '').toUpperCase();
    const color = /^#[0-9a-f]{6}$/i.test(storedColor) && storedColor !== '#22C55E' ? storedColor : defaultColor;
    if (name || group || color !== defaultColor) result[inputId] = { name, group, color };
  }
  return result;
}

function preflightAppsValue(value: unknown): PreflightAppConfigs {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<keyof PreflightAppConfigs, unknown>>
    : {};
  return Object.fromEntries(PREFLIGHT_APP_IDS.map((id) => {
    const item = raw[id] && typeof raw[id] === 'object' && !Array.isArray(raw[id])
      ? raw[id] as Partial<PreflightAppConfigs[typeof id]>
      : {};
    return [id, {
      enabled: booleanValue(item.enabled, DEFAULT_CONFIG.preflightApps[id].enabled),
      path: stringValue(item.path, DEFAULT_CONFIG.preflightApps[id].path).trim().slice(0, 2048),
      restoreWindowPosition: booleanValue(item.restoreWindowPosition, DEFAULT_CONFIG.preflightApps[id].restoreWindowPosition),
      pathSource: preflightPathSourceValue(item.pathSource),
      customLabel: stringValue(item.customLabel, DEFAULT_CONFIG.preflightApps[id].customLabel).trim().slice(0, 32),
      launchUrl: id === 'browser' ? preflightLaunchUrlValue(item.launchUrl) : ''
    }];
  })) as unknown as PreflightAppConfigs;
}

function preflightProjectorValue(value: unknown): AppConfig['preflightProjector'] {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<AppConfig['preflightProjector']>
    : {};
  return {
    enabled: booleanValue(raw.enabled, DEFAULT_CONFIG.preflightProjector.enabled),
    restoreWindowPosition: booleanValue(raw.restoreWindowPosition, DEFAULT_CONFIG.preflightProjector.restoreWindowPosition)
  };
}

function preflightWindowPlacementsValue(value: unknown): PreflightWindowPlacements {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = new Set<string>([...PREFLIGHT_APP_IDS, 'obs_projector']);
  const result: PreflightWindowPlacements = {};
  for (const [target, rawPlacement] of Object.entries(value)) {
    if (!allowed.has(target)) continue;
    const placement = preflightWindowPlacementValue(rawPlacement);
    if (placement) result[target as keyof PreflightWindowPlacements] = placement;
  }
  return result;
}

function preflightWindowPlacementValue(value: unknown): PreflightWindowPlacement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<PreflightWindowPlacement>;
  const capturedWorkArea = preflightRectValue(raw.capturedWorkArea, false);
  const normalizedBounds = preflightRectValue(raw.normalizedBounds, true);
  if (!capturedWorkArea || !normalizedBounds) return null;
  return {
    displayId: nullableIntegerValue(raw.displayId),
    displayLabel: stringValue(raw.displayLabel, '').trim().slice(0, 160),
    capturedWorkArea,
    normalizedBounds,
    windowState: raw.windowState === 'maximized' ? 'maximized' : 'normal',
    capturedAt: Math.max(0, Math.round(numberValue(raw.capturedAt, 0)))
  };
}

function preflightRectValue(value: unknown, normalized: boolean): PreflightWindowPlacement['capturedWorkArea'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<PreflightWindowPlacement['capturedWorkArea']>;
  const x = numberValue(raw.x, Number.NaN);
  const y = numberValue(raw.y, Number.NaN);
  const width = numberValue(raw.width, Number.NaN);
  const height = numberValue(raw.height, Number.NaN);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return normalized
    ? { x: clamp(x, -4, 4), y: clamp(y, -4, 4), width: clamp(width, .05, 4), height: clamp(height, .05, 4) }
    : { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function preflightPathSourceValue(value: unknown): PreflightPathSource {
  return value === 'manual' || value === 'standard' || value === 'registry' || value === 'start_menu' || value === 'desktop'
    ? value
    : 'unknown';
}

function preflightLaunchUrlValue(value: unknown): string {
  const candidate = stringValue(value, '').trim().slice(0, 2048);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}
