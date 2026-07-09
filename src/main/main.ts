import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray, type Rectangle } from 'electron';
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConfigStore } from './configStore.js';
import { getDisplays } from './display.js';
import { HistoryStore } from './historyStore.js';
import { OBSMonitor } from './obsMonitor.js';
import { ATEMMonitor } from './ATEMMonitor.js';
import { DEFAULT_CONFIG, type AlertAction, type AlertHistoryAction, type AppConfig, type AppSnapshot, type DisplayInfo, type UpdateSnapshot, type UpdateSource, type WindowBounds } from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDev = !app.isPackaged;
const shouldUseDevServer = isDev && process.env.npm_lifecycle_event !== 'start';
const rendererUrl = 'http://127.0.0.1:5173';
const appIconPngPath = join(__dirname, '../../../build/icon.png');
const appIconIcoPath = join(__dirname, '../../../build/icon.ico');
const trayMacTemplatePath = join(__dirname, '../../../build/tray-macTemplate.png');
const autoLaunchArgs = ['--hidden'];
const launchHidden = process.argv.includes('--hidden') || process.argv.includes('--background');
const trayIconPaths = {
  safe: join(__dirname, '../../../build/tray-safe.png'),
  warning: join(__dirname, '../../../build/tray-warning.png'),
  danger: join(__dirname, '../../../build/tray-danger.png'),
  idle: join(__dirname, '../../../build/tray-idle.png')
} as const;
const FLOATING_WINDOW_DEFAULT_WIDTH = 340;
const FLOATING_WINDOW_DEFAULT_HEIGHT = 178;
const FLOATING_WINDOW_MIN_WIDTH = 320;
const FLOATING_WINDOW_MAX_WIDTH = 560;
const FLOATING_WINDOW_ASPECT_RATIO = FLOATING_WINDOW_DEFAULT_WIDTH / FLOATING_WINDOW_DEFAULT_HEIGHT;
const FLOATING_WINDOW_RADIUS = 12;
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const UPDATE_INITIAL_CHECK_DELAY_MS = 12 * 1000;
const GITHUB_OWNER = 'Lin518-hub';
const GITHUB_REPO = 'obs-audio-monitor-assistant';
const GITHUB_RELEASE_BASE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/latest/`;
const GH_PROXY_RELEASE_BASE_URL = `https://gh-proxy.com/${GITHUB_RELEASE_BASE_URL}`;
const GHPROXY_NET_RELEASE_BASE_URL = `https://ghproxy.net/${GITHUB_RELEASE_BASE_URL}`;
const { autoUpdater } = electronUpdater;

app.setName('OBS 音频检测助手');
app.setPath('userData', join(app.getPath('appData'), 'obs-audio-monitor-assistant'));

if (process.platform === 'win32') {
  app.setAppUserModelId('com.obsaudioassistant.app');
}

let configStore: ConfigStore;
let historyStore: HistoryStore;
let monitor: OBSMonitor;
let atemMonitor: ATEMMonitor;
let settingsWindow: BrowserWindow | null = null;
let isQuitting = false;
let tray: Tray | null = null;
let latestSnapshot: AppSnapshot | null = null;
let updateState: UpdateSnapshot | null = null;
let updateCheckInFlight: Promise<UpdateSnapshot> | null = null;
let updateInitialTimer: NodeJS.Timeout | null = null;
let updateCheckTimer: NodeJS.Timeout | null = null;
let alertActionInProgress = false;
let floatingWindow: BrowserWindow | null = null;
let isAdjustingFloatingWindowSize = false;
const alertWindows = new Map<number, BrowserWindow>();
const preAlertWindows = new Map<number, BrowserWindow>();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showSettingsWindow();
  });
  app.on('activate', () => {
    showSettingsWindow();
  });

  app.whenReady().then(() => {
    void initializeApp().catch((error) => {
      console.error(`[app] failed to initialize: ${error instanceof Error ? error.message : String(error)}`);
      app.quit();
    });
  });
}

async function initializeApp(): Promise<void> {
  Menu.setApplicationMenu(null);
  if (process.platform === 'darwin') {
    app.dock?.setIcon(appIconPngPath);
  }
  configStore = new ConfigStore();
  historyStore = new HistoryStore();
  let config = await configStore.load();
  const systemAutoLaunchEnabled = getAutoLaunchEnabled();
  if (systemAutoLaunchEnabled && !config.autoLaunch) {
    config = await configStore.save({ ...config, autoLaunch: true });
  } else if (config.autoLaunch) {
    await applyAutoLaunch(true);
  }
  const history = await historyStore.load();
  monitor = new OBSMonitor(config, getDisplays());
  monitor.setHistory(history);

  atemMonitor = new ATEMMonitor();
  latestSnapshot = injectATEMState(monitor.getSnapshot());

  void atemMonitor.setConfig(config.atemEnabled, config.atemHost).then(() => {
    const merged = injectATEMState(monitor.getSnapshot());
    latestSnapshot = merged;
    broadcastSnapshot(merged);
  });

  registerIpc();
  createTray();
  initializeUpdater();
  if (!launchHidden) {
    createSettingsWindow();
  }
  if (latestSnapshot.config.floatingWindowEnabled) {
    showFloatingWindow(latestSnapshot);
  }

  screen.on('display-added', refreshDisplays);
  screen.on('display-removed', refreshDisplays);
  screen.on('display-metrics-changed', refreshDisplays);

  monitor.on('snapshot', (snapshot) => {
    const merged = injectATEMState(snapshot);
    latestSnapshot = merged;
    broadcastSnapshot(merged);
    updateTray(snapshot);
    syncFloatingWindow(snapshot);
    if (snapshot.preAlertVisible && !snapshot.alertVisible) {
      showPreAlertWindows(snapshot);
    } else {
      closePreAlertWindows('destroy');
    }
    if (!snapshot.alertVisible) {
      closeAlertWindows('destroy');
    }
  });
  monitor.on('alert', (snapshot) => {
    const merged = injectATEMState(snapshot);
    latestSnapshot = merged;
    closePreAlertWindows('destroy');
    showAlertWindows(snapshot);
  });

  atemMonitor.on('stateChanged', () => {
    if (latestSnapshot) {
      const merged = injectATEMState(latestSnapshot);
      latestSnapshot = merged;
      broadcastSnapshot(merged);
    }
  });

  await monitor.start();
}

app.on('window-all-closed', () => {
  // Keep the companion app alive in the tray after the settings window closes.
});

app.on('before-quit', () => {
  isQuitting = true;
  if (updateInitialTimer) {
    clearTimeout(updateInitialTimer);
    updateInitialTimer = null;
  }
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  void monitor?.stop();
  void atemMonitor?.stop();
  unregisterATEMHotkeys();
});

function getAutoLaunchEnabled(): boolean {
  try {
    return app.getLoginItemSettings({
      path: process.execPath,
      args: autoLaunchArgs
    }).openAtLogin;
  } catch (error) {
    console.error(`[auto-launch] failed to read setting: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function applyAutoLaunch(enabled: boolean): Promise<void> {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: enabled,
      path: process.execPath,
      args: enabled ? autoLaunchArgs : []
    });
  } catch (error) {
    console.error(`[auto-launch] failed to update setting: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function registerIpc(): void {
  ipcMain.handle('snapshot:get', () => latestSnapshot ?? monitor.getSnapshot());
  ipcMain.handle('config:save', async (_event, patch: Partial<AppConfig>) => {
    const previous = (latestSnapshot ?? monitor.getSnapshot()).config;
    const nextConfig = await configStore.save({
      ...previous,
      ...patch
    });
    if (Object.hasOwn(patch, 'autoLaunch') && nextConfig.autoLaunch !== previous.autoLaunch) {
      await applyAutoLaunch(nextConfig.autoLaunch);
    }
    const snapshot = await monitor.updateConfig(nextConfig);
    latestSnapshot = injectATEMState(snapshot);
    broadcastSnapshot(latestSnapshot);
    updateTray(latestSnapshot);
    if (Object.hasOwn(patch, 'floatingWindowEnabled') || Object.hasOwn(patch, 'floatingWindowBounds')) {
      syncFloatingWindow(latestSnapshot);
    }
    if (Object.hasOwn(patch, 'atemEnabled') || Object.hasOwn(patch, 'atemHost')) {
      void atemMonitor.setConfig(nextConfig.atemEnabled, nextConfig.atemHost).then(() => {
        if (latestSnapshot) {
          const merged = injectATEMState(latestSnapshot);
          latestSnapshot = merged;
          broadcastSnapshot(merged);
        }
        syncATEMHotkeys();
      });
    }
    if (Object.hasOwn(patch, 'atemHotkeyGlobal')) {
      syncATEMHotkeys();
    }
    if (Object.hasOwn(patch, 'updateSource') || Object.hasOwn(patch, 'aliyunUpdateBaseUrl')) {
      refreshUpdateSourceState(nextConfig);
    }
    return latestSnapshot;
  });
  ipcMain.handle('config:reset', () => resetToFactoryDefaults());
  ipcMain.handle('inputs:refresh', () => monitor.refreshInputs());
  ipcMain.handle('obs:reconnect', () => monitor.reconnect());
  ipcMain.handle('obs:test-connection', async (_event, patch: Partial<AppConfig>) => {
    const config = {
      ...(latestSnapshot ?? monitor.getSnapshot()).config,
      ...patch
    };
    return monitor.testConnection(config);
  });
  ipcMain.handle('monitor:set-paused', async (_event, paused: boolean) => {
    const nextConfig = await configStore.save({
      ...(latestSnapshot ?? monitor.getSnapshot()).config,
      paused
    });
    return monitor.updateConfig(nextConfig);
  });
  ipcMain.handle('monitor:set-simulated-live', (_event, enabled: boolean) => {
    const snapshot = monitor.setSimulatedLive(enabled);
    latestSnapshot = snapshot;
    broadcastSnapshot(snapshot);
    updateTray(snapshot);
    return snapshot;
  });
  ipcMain.handle('alert:test', () => {
    const snapshot = monitor.triggerTestAlert();
    latestSnapshot = snapshot;
    closePreAlertWindows('destroy');
    showAlertWindows(snapshot);
    broadcastSnapshot(snapshot);
    return snapshot;
  });
  ipcMain.handle('alert:action', async (_event, action: AlertAction) => {
    return handleAlertActionFromMain(action);
  });
  ipcMain.handle('alert:force-close', () => {
    return handleAlertActionFromMain('acknowledge');
  });
  ipcMain.handle('prealert:dismiss', () => {
    closePreAlertWindows('destroy');
    const snapshot = monitor.dismissPreAlert();
    latestSnapshot = snapshot;
    broadcastSnapshot(snapshot);
    return snapshot;
  });
  ipcMain.handle('floating:set-visible', async (_event, visible: boolean) => setFloatingWindowVisible(visible));
  ipcMain.handle('settings:show', () => {
    showSettingsWindow();
  });
  ipcMain.handle('history:list', () => historyStore.list());
  ipcMain.handle('history:clear', async () => {
    const history = await historyStore.clear();
    monitor.setHistory(history);
    const snapshot = monitor.getSnapshot();
    latestSnapshot = snapshot;
    broadcastSnapshot(snapshot);
    return history;
  });
  ipcMain.handle('alert:position-updated', async (_event, displayId: number, position: { x: number; y: number }) => {
    await saveAlertPosition(displayId, position);
  });
  ipcMain.handle('displays:get', () => getDisplays());
  ipcMain.handle('update:get-state', () => getUpdateState());
  ipcMain.handle('update:check', () => checkForUpdates(true));
  ipcMain.handle('update:download', () => downloadUpdate());
  ipcMain.handle('update:install', () => installDownloadedUpdate());
  ipcMain.handle('atem:get-state', () => atemMonitor.getSnapshot());
  ipcMain.handle('atem:change-preview-input', async (_event, input: number) => {
    await atemMonitor.changePreviewInput(input);
  });
  ipcMain.handle('atem:auto-transition', async () => {
    await atemMonitor.autoTransition();
  });
  ipcMain.handle('atem:change-program-input', async (_event, input: number) => {
    await atemMonitor.changeProgramInput(input);
  });
  ipcMain.handle('atem:test-connection', async (_event, host: string) => {
    return atemMonitor.testConnection(host);
  });
  ipcMain.handle('atem:reconnect', async () => {
    await atemMonitor.connect();
    const merged = injectATEMState(monitor.getSnapshot());
    latestSnapshot = merged;
    broadcastSnapshot(merged);
  });
}

// Merge ATEM state into an AppSnapshot
function injectATEMState(snapshot: AppSnapshot): AppSnapshot {
  const atem = atemMonitor?.getSnapshot();
  if (!atem) {
    return snapshot;
  }
  return {
    ...snapshot,
    atemConnected: atem.connected,
    atemConnectionState: atem.connectionState,
    atemProgramInput: atem.programInput,
    atemPreviewInput: atem.previewInput,
    atemInputLabels: atem.inputLabels,
    atemInputCount: atem.inputCount
  };
}

function syncATEMHotkeys(): void {
  const config = (latestSnapshot ?? monitor.getSnapshot()).config;
  unregisterATEMHotkeys();
  if (config.atemEnabled && config.atemHotkeyGlobal) {
    registerATEMHotkeys();
  }
}

function registerATEMHotkeys(): void {
  const atem = atemMonitor;
  if (!atem) return;

  for (let i = 1; i <= 9; i++) {
    const accelerator = `num${i}`;
    try {
      globalShortcut.register(accelerator, () => {
        void atem.changePreviewInput(i);
      });
    } catch (error) {
      console.error(`[ATEM] failed to register global shortcut ${accelerator}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function unregisterATEMHotkeys(): void {
  try {
    globalShortcut.unregisterAll();
  } catch {
    // Some shortcuts may not be registered.
  }
}

function initializeUpdater(): void {
  updateState = createInitialUpdateState();
  broadcastUpdateState();

  if (!isUpdaterSupported()) {
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload = true;

  autoUpdater.on('checking-for-update', () => {
    const state = getUpdateState();
    setUpdateState({
      status: 'checking',
      percent: null,
      errorMessage: null,
      message: `正在检查 ${state.sourceLabel} 上的新版本...`
    });
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    const state = getUpdateState();
    setUpdateState({
      status: 'available',
      availableVersion: info.version ?? null,
      downloadedVersion: null,
      percent: null,
      errorMessage: null,
      lastCheckedAt: Date.now(),
      message: info.version ? `${state.sourceLabel} 发现新版本 ${info.version}` : `${state.sourceLabel} 发现新版本`
    });
  });
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    const state = getUpdateState();
    setUpdateState({
      status: 'not_available',
      availableVersion: info.version ?? null,
      downloadedVersion: null,
      percent: null,
      errorMessage: null,
      lastCheckedAt: Date.now(),
      message: `${state.sourceLabel} 已确认当前为最新版本`
    });
  });
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    setUpdateState({
      status: 'downloading',
      percent: Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : null,
      errorMessage: null,
      message: '正在下载更新...'
    });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    const version = info.version ?? getUpdateState().availableVersion;
    setUpdateState({
      status: 'downloaded',
      availableVersion: version,
      downloadedVersion: version,
      percent: 100,
      errorMessage: null,
      message: version ? `新版本 ${version} 已下载，重启后安装` : '更新已下载，重启后安装'
    });
  });
  autoUpdater.on('error', (error: Error) => {
    const errorMessage = formatUpdateError(error);
    setUpdateState({
      status: 'error',
      percent: null,
      errorMessage,
      lastCheckedAt: Date.now(),
      message: errorMessage
    });
  });

  updateInitialTimer = setTimeout(() => {
    void checkForUpdates(false);
  }, UPDATE_INITIAL_CHECK_DELAY_MS);
  updateCheckTimer = setInterval(() => {
    void checkForUpdates(false);
  }, UPDATE_CHECK_INTERVAL_MS);
}

function getUpdateState(): UpdateSnapshot {
  if (!updateState) {
    updateState = createInitialUpdateState();
  }

  return updateState;
}

function createInitialUpdateState(): UpdateSnapshot {
  const source = resolveConfiguredUpdateSource();
  return {
    status: isUpdaterSupported() ? 'idle' : 'unsupported',
    source: source.id,
    sourceLabel: source.label,
    sourceUrl: source.url,
    attemptedSources: [],
    currentVersion: app.getVersion(),
    availableVersion: null,
    downloadedVersion: null,
    percent: null,
    message: isUpdaterSupported() ? '可检查更新' : '打包安装后可检查更新',
    lastCheckedAt: null,
    errorMessage: null
  };
}

function isUpdaterSupported(): boolean {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');
}

function setUpdateState(patch: Partial<UpdateSnapshot>): UpdateSnapshot {
  updateState = {
    ...getUpdateState(),
    ...patch,
    currentVersion: app.getVersion()
  };
  broadcastUpdateState();
  if (latestSnapshot) {
    updateTray(latestSnapshot);
  }
  return updateState;
}

async function checkForUpdates(manual: boolean): Promise<UpdateSnapshot> {
  if (!isUpdaterSupported()) {
    const source = resolveConfiguredUpdateSource();
    return setUpdateState({
      status: 'unsupported',
      source: source.id,
      sourceLabel: source.label,
      sourceUrl: source.url,
      attemptedSources: [],
      message: '请在已安装的 Windows 或 macOS 版本中检查更新',
      errorMessage: null
    });
  }

  const current = getUpdateState();
  if (current.status === 'downloaded') {
    return current;
  }

  if (updateCheckInFlight) {
    return updateCheckInFlight;
  }

  updateCheckInFlight = (async () => {
    const candidates = resolveUpdateCandidates(currentUpdateConfig());
    if (candidates.length === 0) {
      const source = resolveConfiguredUpdateSource();
      return setUpdateState({
        status: 'error',
        source: source.id,
        sourceLabel: source.label,
        sourceUrl: source.url,
        attemptedSources: [],
        percent: null,
        errorMessage: '阿里云镜像源尚未配置',
        lastCheckedAt: Date.now(),
        message: '请先填写阿里云 OSS/CDN 镜像地址，或切换到 GitHub / GitHub 加速源'
      });
    }

    const attemptedSources: string[] = [];
    let lastError: unknown = null;

    for (const candidate of candidates) {
      attemptedSources.push(candidate.label);
      autoUpdater.setFeedURL(candidate.feed);
      setUpdateState({
        status: 'checking',
        source: candidate.id,
        sourceLabel: candidate.label,
        sourceUrl: candidate.url,
        attemptedSources: [...attemptedSources],
        percent: null,
        errorMessage: null,
        message: manual ? `正在检查 ${candidate.label}...` : `正在通过 ${candidate.label} 后台检查更新...`
      });

      try {
        const result = await autoUpdater.checkForUpdates();
        const latest = getUpdateState();
        if (latest.status === 'checking') {
          const version = result?.updateInfo.version ?? latest.availableVersion ?? null;
          setUpdateState({
            status: 'not_available',
            availableVersion: version,
            lastCheckedAt: Date.now(),
            message: `${candidate.label} 已确认当前为最新版本`
          });
        }
        return getUpdateState();
      } catch (error) {
        lastError = error;
        if (currentUpdateConfig().updateSource !== 'auto') {
          break;
        }
      }
    }

    const errorMessage = formatUpdateError(lastError);
    return setUpdateState({
      status: 'error',
      percent: null,
      errorMessage,
      attemptedSources,
      lastCheckedAt: Date.now(),
      message: attemptedSources.length > 1 ? `${errorMessage}；已尝试 ${attemptedSources.join('、')}` : errorMessage
    });
  })();

  return updateCheckInFlight.finally(() => {
    updateCheckInFlight = null;
  });
}

type UpdateFeed = Parameters<typeof autoUpdater.setFeedURL>[0];

interface UpdateSourceInfo {
  id: UpdateSource;
  label: string;
  url: string | null;
}

interface UpdateCandidate extends UpdateSourceInfo {
  feed: UpdateFeed;
}

function currentUpdateConfig(): AppConfig {
  return (latestSnapshot ?? monitor?.getSnapshot())?.config ?? DEFAULT_CONFIG;
}

function refreshUpdateSourceState(config: AppConfig): void {
  const source = resolveConfiguredUpdateSource(config);
  setUpdateState({
    status: isUpdaterSupported() ? 'idle' : 'unsupported',
    source: source.id,
    sourceLabel: source.label,
    sourceUrl: source.url,
    attemptedSources: [],
    percent: null,
    errorMessage: null,
    message: isUpdaterSupported() ? `更新源已切换为 ${source.label}` : '打包安装后可检查更新'
  });
}

function resolveConfiguredUpdateSource(config = currentUpdateConfig()): UpdateSourceInfo {
  if (config.updateSource === 'auto') {
    return {
      id: 'auto',
      label: config.aliyunUpdateBaseUrl ? '自动选择（阿里云优先）' : '自动选择（GitHub 加速优先）',
      url: null
    };
  }

  const candidates = sourceCandidatesFor(config, false);
  return candidates[0] ?? { id: config.updateSource, label: updateSourceLabel(config.updateSource), url: null };
}

function resolveUpdateCandidates(config: AppConfig): UpdateCandidate[] {
  if (config.updateSource === 'auto') {
    return sourceCandidatesFor(config, true);
  }

  return sourceCandidatesFor(config, false).filter((candidate) => candidate.id === config.updateSource);
}

function sourceCandidatesFor(config: AppConfig, includeFallbacks: boolean): UpdateCandidate[] {
  const aliyunUrl = normalizeUpdateBaseUrl(config.aliyunUpdateBaseUrl);
  const candidates: UpdateCandidate[] = [];

  if ((config.updateSource === 'aliyun' || includeFallbacks) && aliyunUrl) {
    candidates.push(genericUpdateCandidate('aliyun', '阿里云 OSS/CDN 镜像', aliyunUrl));
  }

  if (config.updateSource === 'gh_proxy' || includeFallbacks) {
    candidates.push(genericUpdateCandidate('gh_proxy', 'GitHub 加速源 gh-proxy.com', GH_PROXY_RELEASE_BASE_URL));
  }

  if (config.updateSource === 'ghproxy_net' || includeFallbacks) {
    candidates.push(genericUpdateCandidate('ghproxy_net', 'GitHub 加速源 ghproxy.net', GHPROXY_NET_RELEASE_BASE_URL));
  }

  if (config.updateSource === 'github' || includeFallbacks) {
    candidates.push(genericUpdateCandidate('github', 'GitHub Releases', GITHUB_RELEASE_BASE_URL));
  }

  return candidates;
}

function genericUpdateCandidate(id: UpdateSource, label: string, url: string): UpdateCandidate {
  const normalized = normalizeUpdateBaseUrl(url);
  return {
    id,
    label,
    url: normalized,
    feed: {
      provider: 'generic',
      url: normalized
    } as UpdateFeed
  };
}

function updateSourceLabel(source: UpdateSource): string {
  const labels: Record<UpdateSource, string> = {
    auto: '自动选择',
    github: 'GitHub Releases',
    gh_proxy: 'GitHub 加速源 gh-proxy.com',
    ghproxy_net: 'GitHub 加速源 ghproxy.net',
    aliyun: '阿里云 OSS/CDN 镜像'
  };

  return labels[source];
}

function normalizeUpdateBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

async function downloadUpdate(): Promise<UpdateSnapshot> {
  if (!isUpdaterSupported()) {
    return getUpdateState();
  }

  const current = getUpdateState();
  if (current.status === 'downloaded' || current.status === 'downloading') {
    return current;
  }

  if (current.status !== 'available') {
    const checked = await checkForUpdates(true);
    if (checked.status !== 'available') {
      return checked;
    }
  }

  try {
    setUpdateState({
      status: 'downloading',
      percent: 0,
      errorMessage: null,
      message: '正在下载更新...'
    });
    await autoUpdater.downloadUpdate();
    return getUpdateState();
  } catch (error) {
    const errorMessage = formatUpdateError(error);
    return setUpdateState({
      status: 'error',
      percent: null,
      errorMessage,
      lastCheckedAt: Date.now(),
      message: errorMessage
    });
  }
}

function installDownloadedUpdate(): UpdateSnapshot {
  const current = getUpdateState();
  if (current.status !== 'downloaded') {
    return current;
  }

  isQuitting = true;
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });
  return current;
}

function formatUpdateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/github|api\.github|release|latest\.yml/i.test(raw)) {
    return '无法连接 GitHub 更新源，请稍后重试或手动下载新版安装包';
  }

  if (/net|timeout|econn|enotfound|certificate|proxy/i.test(raw)) {
    return '网络无法访问更新源，请检查网络、代理或稍后重试';
  }

  return raw ? `检查更新失败：${raw}` : '检查更新失败';
}

function createSettingsWindow(): void {
  settingsWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 860,
    minHeight: 620,
    title: 'OBS 音频检测助手',
    icon: appIconPath(),
    backgroundColor: '#f6f8fb',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  attachWindowDiagnostics(settingsWindow, 'settings');
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.removeMenu();
  loadRendererSafely(settingsWindow, '#settings', 'settings');

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  settingsWindow.on('close', (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    settingsWindow?.hide();
  });
}

function showSettingsWindow(): void {
  if (!settingsWindow) {
    createSettingsWindow();
  }

  settingsWindow?.show();
  settingsWindow?.focus();
}

function showFloatingWindow(snapshot: AppSnapshot): void {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.webContents.send('snapshot', snapshot);
    return;
  }

  const bounds = resolveFloatingWindowBounds(snapshot);
  floatingWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: FLOATING_WINDOW_MIN_WIDTH,
    minHeight: floatingWindowHeightForWidth(FLOATING_WINDOW_MIN_WIDTH),
    maxWidth: FLOATING_WINDOW_MAX_WIDTH,
    maxHeight: floatingWindowHeightForWidth(FLOATING_WINDOW_MAX_WIDTH),
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    hasShadow: false,
    icon: appIconPath(),
    skipTaskbar: true,
    frame: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  attachWindowDiagnostics(floatingWindow, 'floating');
  floatingWindow.setAlwaysOnTop(true, 'floating');
  floatingWindow.setAspectRatio(FLOATING_WINDOW_ASPECT_RATIO);
  applyFloatingWindowShape();
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatingWindow.once('ready-to-show', () => {
    applyFloatingWindowShape();
    floatingWindow?.showInactive();
  });
  floatingWindow.on('moved', () => {
    saveFloatingWindowBoundsFromWindow();
  });
  floatingWindow.on('resized', () => {
    keepFloatingWindowAspectRatio();
    applyFloatingWindowShape();
    saveFloatingWindowBoundsFromWindow();
  });
  floatingWindow.on('closed', () => {
    floatingWindow = null;
  });

  loadRendererSafely(floatingWindow, '#floating', 'floating');
}

function closeFloatingWindow(mode: 'close' | 'destroy' = 'destroy'): void {
  if (!floatingWindow) {
    return;
  }

  safelyCloseWindow(floatingWindow, mode);
  floatingWindow = null;
}

function syncFloatingWindow(snapshot: AppSnapshot): void {
  if (snapshot.config.floatingWindowEnabled) {
    showFloatingWindow(snapshot);
    return;
  }

  closeFloatingWindow('destroy');
}

async function setFloatingWindowVisible(visible: boolean): Promise<AppSnapshot> {
  const snapshot = latestSnapshot ?? monitor.getSnapshot();
  const nextConfig = await configStore.save({
    ...snapshot.config,
    floatingWindowEnabled: visible
  });
  const nextSnapshot = await monitor.updateConfig(nextConfig);
  latestSnapshot = nextSnapshot;

  if (visible) {
    showFloatingWindow(nextSnapshot);
  } else {
    closeFloatingWindow('destroy');
  }

  updateTray(nextSnapshot);
  broadcastSnapshot(nextSnapshot);
  return nextSnapshot;
}

async function resetToFactoryDefaults(): Promise<AppSnapshot> {
  closeAlertWindows('destroy');
  closePreAlertWindows('destroy');
  closeFloatingWindow('destroy');

  await historyStore.clear();
  monitor.setHistory([]);
  monitor.resetTransientState();
  await applyAutoLaunch(false);

  const nextConfig = await configStore.reset();
  const nextSnapshot = await monitor.updateConfig(nextConfig);
  latestSnapshot = nextSnapshot;

  updateTray(nextSnapshot);
  broadcastSnapshot(nextSnapshot);
  return nextSnapshot;
}

function saveFloatingWindowBoundsFromWindow(): void {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    return;
  }

  const bounds = floatingWindow.getBounds();
  void saveFloatingWindowBounds(bounds);
}

async function saveFloatingWindowBounds(bounds: WindowBounds): Promise<void> {
  const snapshot = latestSnapshot ?? monitor.getSnapshot();
  if (!snapshot.config.floatingWindowEnabled) {
    return;
  }

  const nextConfig = await configStore.save({
    ...snapshot.config,
    floatingWindowBounds: bounds
  });
  await monitor.updateConfig(nextConfig);
}

function showAlertWindows(snapshot: AppSnapshot): void {
  closeAlertWindows('destroy');
  const displays = selectAlertDisplays(snapshot.config.alertDisplayMode, snapshot.config.alertDisplayId, snapshot.displays);

  for (const display of displays) {
    const width = Math.min(560, Math.floor(display.bounds.width * 0.86));
    const height = Math.min(260, Math.floor(display.bounds.height * 0.42));
    const position = resolveAlertPosition(snapshot, display, width, height);

    const alertWindow = new BrowserWindow({
      x: position.x,
      y: position.y,
      width,
      height,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      icon: appIconPath(),
      skipTaskbar: true,
      frame: false,
      show: false,
      backgroundColor: '#6f1118',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    attachWindowDiagnostics(alertWindow, `alert:${display.id}`);
    alertWindow.setAlwaysOnTop(true, 'floating');
    alertWindow.once('ready-to-show', () => alertWindow.showInactive());
    alertWindow.on('moved', () => {
      if (!snapshot.config.rememberAlertPosition) {
        return;
      }

      const [x, y] = alertWindow.getPosition();
      void saveAlertPosition(display.id, { x, y });
    });
    alertWindow.on('closed', () => {
      alertWindows.delete(display.id);
    });
    alertWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') {
        return;
      }

      if (input.key === 'Escape' || input.key === 'Enter') {
        event.preventDefault();
        void handleAlertActionFromMain('acknowledge');
      }
    });

    alertWindows.set(display.id, alertWindow);
    loadRendererSafely(alertWindow, '#alert', `alert:${display.id}`);
  }
}

function showPreAlertWindows(snapshot: AppSnapshot): void {
  const displays = selectAlertDisplays(snapshot.config.alertDisplayMode, snapshot.config.alertDisplayId, snapshot.displays);
  const wantedIds = new Set(displays.map((display) => display.id));

  for (const [displayId, window] of preAlertWindows) {
    if (!wantedIds.has(displayId) && !window.isDestroyed()) {
      safelyCloseWindow(window, 'destroy');
      preAlertWindows.delete(displayId);
    }
  }

  for (const display of displays) {
    if (preAlertWindows.has(display.id)) {
      continue;
    }

    const width = Math.min(460, Math.floor(display.bounds.width * 0.78));
    const height = 112;
    const x = display.bounds.x + Math.round((display.bounds.width - width) / 2);
    const y = display.bounds.y + Math.round(display.bounds.height * 0.72);

    const preAlertWindow = new BrowserWindow({
      x,
      y,
      width,
      height,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      icon: appIconPath(),
      skipTaskbar: true,
      frame: false,
      show: false,
      focusable: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    attachWindowDiagnostics(preAlertWindow, `prealert:${display.id}`);
    preAlertWindow.setAlwaysOnTop(true, 'floating');
    preAlertWindow.once('ready-to-show', () => preAlertWindow.showInactive());
    preAlertWindow.on('closed', () => {
      preAlertWindows.delete(display.id);
    });

    preAlertWindows.set(display.id, preAlertWindow);
    loadRendererSafely(preAlertWindow, '#prealert', `prealert:${display.id}`);
  }
}

function closeAlertWindows(mode: 'close' | 'destroy' = 'destroy'): void {
  for (const window of alertWindows.values()) {
    safelyCloseWindow(window, mode);
  }
  alertWindows.clear();
}

function closePreAlertWindows(mode: 'close' | 'destroy' = 'destroy'): void {
  for (const window of preAlertWindows.values()) {
    safelyCloseWindow(window, mode);
  }
  preAlertWindows.clear();
}

function safelyCloseWindow(window: BrowserWindow, mode: 'close' | 'destroy'): void {
  if (window.isDestroyed()) {
    return;
  }

  try {
    if (mode === 'destroy') {
      window.destroy();
      return;
    }

    window.close();
  } catch (error) {
    console.error(`[window] failed to ${mode}: ${error instanceof Error ? error.message : String(error)}`);
    try {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    } catch {
      // Nothing else to do.
    }
  }
}

async function handleAlertActionFromMain(action: AlertAction): Promise<AppSnapshot> {
  if (alertActionInProgress) {
    return latestSnapshot ?? monitor.getSnapshot();
  }

  alertActionInProgress = true;
  const before = latestSnapshot ?? monitor.getSnapshot();
  const shouldRecord = before.alertVisible && !monitor.isTestAlertActive() && isHistoryAction(action);

  try {
    closeAlertWindows('destroy');
    closePreAlertWindows('destroy');
    monitor.handleAlertAction(action);

    if (shouldRecord) {
      try {
        const history = await historyStore.add({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          inputName: before.config.targetInputName || '目标音源',
          silentForSeconds: before.silentForSeconds,
          action,
          status: before.status
        });
        monitor.setHistory(history);
      } catch (error) {
        console.error(`[history] failed to write alert action: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    latestSnapshot = monitor.getSnapshot();
    broadcastSnapshot(latestSnapshot);
    return latestSnapshot;
  } finally {
    alertActionInProgress = false;
  }
}

function createTray(): void {
  const snapshot = latestSnapshot ?? monitor.getSnapshot();
  tray = new Tray(createTrayIcon(trayTone(snapshot)));
  tray.setToolTip('OBS 音频检测助手');
  tray.on('double-click', showSettingsWindow);
  updateTray(snapshot);
}

function updateTray(snapshot: AppSnapshot): void {
  if (!tray) {
    return;
  }

  const statusText = statusLabel(snapshot.status);
  tray.setImage(createTrayIcon(trayTone(snapshot)));
  tray.setToolTip(`OBS 音频检测助手 - ${statusText}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `状态：${statusText}`, enabled: false },
      { label: '打开设置', click: showSettingsWindow },
      {
        label: updateTrayLabel(),
        enabled: updateTrayEnabled(),
        click: () => {
          void handleTrayUpdateClick();
        }
      },
      {
        label: snapshot.config.floatingWindowEnabled ? '关闭小浮窗' : '打开小浮窗',
        click: () => {
          void setFloatingWindowVisible(!snapshot.config.floatingWindowEnabled);
        }
      },
      {
        label: snapshot.config.paused ? '恢复检测' : '暂停检测',
        click: () => {
          void (async () => {
            const nextConfig = await configStore.save({ ...snapshot.config, paused: !snapshot.config.paused });
            await monitor.updateConfig(nextConfig);
          })();
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
}

async function loadRenderer(window: BrowserWindow, hash: string): Promise<void> {
  if (shouldUseDevServer) {
    try {
      await window.loadURL(`${rendererUrl}/${hash}`);
      return;
    } catch {
      // A built renderer lets `npm start` run without a Vite dev server.
    }
  }

  await window.loadFile(join(__dirname, '../../renderer/index.html'), { hash: hash.replace(/^#/, '') });
}

function loadRendererSafely(window: BrowserWindow, hash: string, label: string): void {
  void loadRenderer(window, hash).catch((error) => {
    if (!window.isDestroyed()) {
      console.error(`[${label}] renderer load rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function broadcastSnapshot(snapshot: AppSnapshot): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('snapshot', snapshot);
  });
}

function broadcastUpdateState(): void {
  if (!updateState) {
    return;
  }

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('update:state', updateState);
  });
}

function attachWindowDiagnostics(window: BrowserWindow, label: string): void {
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`[${label}] failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[${label}] renderer gone: ${details.reason}`);
  });
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelName = ['log', 'warn', 'error', 'debug'][level] ?? String(level);
    console.log(`[${label}] ${levelName}: ${message} (${sourceId}:${line})`);
  });
}

function refreshDisplays(): void {
  monitor.setDisplays(getDisplays());
}

async function saveAlertPosition(displayId: number, position: { x: number; y: number }): Promise<void> {
  const snapshot = latestSnapshot ?? monitor.getSnapshot();
  if (!snapshot.config.rememberAlertPosition) {
    return;
  }

  const nextConfig = await configStore.save({
    ...snapshot.config,
    alertPositions: {
      ...snapshot.config.alertPositions,
      [String(displayId)]: position
    }
  });
  await monitor.updateConfig(nextConfig);
}

function resolveAlertPosition(
  snapshot: AppSnapshot,
  display: DisplayInfo,
  width: number,
  height: number
): { x: number; y: number } {
  const saved = snapshot.config.rememberAlertPosition ? snapshot.config.alertPositions[String(display.id)] : null;
  const fallback = {
    x: display.bounds.x + Math.round((display.bounds.width - width) / 2),
    y: display.bounds.y + Math.round((display.bounds.height - height) / 2)
  };

  if (!saved) {
    return fallback;
  }

  return {
    x: Math.min(display.bounds.x + display.bounds.width - width, Math.max(display.bounds.x, saved.x)),
    y: Math.min(display.bounds.y + display.bounds.height - height, Math.max(display.bounds.y, saved.y))
  };
}

function resolveFloatingWindowBounds(snapshot: AppSnapshot): WindowBounds {
  const saved = snapshot.config.floatingWindowBounds;
  const width = saved ? clamp(saved.width, FLOATING_WINDOW_MIN_WIDTH, FLOATING_WINDOW_MAX_WIDTH) : FLOATING_WINDOW_DEFAULT_WIDTH;
  const height = floatingWindowHeightForWidth(width);
  const displays = snapshot.displays.length > 0 ? snapshot.displays : getDisplays();
  const primary = displays.find((display) => display.primary) ?? displays[0];

  if (!primary) {
    return {
      x: saved?.x ?? 80,
      y: saved?.y ?? 80,
      width,
      height
    };
  }

  const fallback = {
    x: primary.bounds.x + primary.bounds.width - width - 28,
    y: primary.bounds.y + 72
  };
  const x = saved?.x ?? fallback.x;
  const y = saved?.y ?? fallback.y;
  const display =
    displays.find((item) => x >= item.bounds.x && x < item.bounds.x + item.bounds.width && y >= item.bounds.y && y < item.bounds.y + item.bounds.height) ??
    primary;

  return {
    x: clamp(x, display.bounds.x, display.bounds.x + display.bounds.width - width),
    y: clamp(y, display.bounds.y, display.bounds.y + display.bounds.height - height),
    width,
    height
  };
}

function floatingWindowHeightForWidth(width: number): number {
  return Math.round(width / FLOATING_WINDOW_ASPECT_RATIO);
}

function keepFloatingWindowAspectRatio(): void {
  if (!floatingWindow || floatingWindow.isDestroyed() || isAdjustingFloatingWindowSize) {
    return;
  }

  const bounds = floatingWindow.getBounds();
  const width = clamp(bounds.width, FLOATING_WINDOW_MIN_WIDTH, FLOATING_WINDOW_MAX_WIDTH);
  const height = floatingWindowHeightForWidth(width);
  if (bounds.width === width && Math.abs(bounds.height - height) <= 1) {
    return;
  }

  isAdjustingFloatingWindowSize = true;
  floatingWindow.setBounds({ ...bounds, width, height }, false);
  isAdjustingFloatingWindowSize = false;
}

function applyFloatingWindowShape(): void {
  if (process.platform !== 'win32' || !floatingWindow || floatingWindow.isDestroyed()) {
    return;
  }

  const windowWithShape = floatingWindow as BrowserWindow & {
    setShape?: (rectangles: Rectangle[]) => void;
  };
  if (typeof windowWithShape.setShape !== 'function') {
    return;
  }

  const { width, height } = floatingWindow.getBounds();
  const radius = Math.min(FLOATING_WINDOW_RADIUS, Math.floor(width / 2), Math.floor(height / 2));
  const rectangles: Rectangle[] = [];

  for (let y = 0; y < height; y += 1) {
    const distanceFromTop = y < radius ? radius - y : y >= height - radius ? y - (height - radius - 1) : 0;
    if (distanceFromTop <= 0) {
      rectangles.push({ x: 0, y, width, height: 1 });
      continue;
    }

    const inset = Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - distanceFromTop * distanceFromTop)));
    rectangles.push({
      x: inset,
      y,
      width: Math.max(0, width - inset * 2),
      height: 1
    });
  }

  windowWithShape.setShape(rectangles);
}

function selectAlertDisplays(mode: string, displayId: number | null, displays: DisplayInfo[]): DisplayInfo[] {
  if (mode === 'all') {
    return displays;
  }

  if (mode === 'display_id' && displayId !== null) {
    const selected = displays.find((display) => display.id === displayId);
    if (selected) {
      return [selected];
    }
  }

  const primary = displays.find((display) => display.primary);
  return primary ? [primary] : displays.slice(0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function appIconPath(): string {
  return process.platform === 'win32' ? appIconIcoPath : appIconPngPath;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    disconnected: 'OBS 未连接',
    connecting: '正在连接',
    idle_not_streaming: '等待直播/录制',
    monitoring: '检测中',
    silent_counting: '静音计时中',
    pre_alert: '预警中',
    alerting: '正在报警',
    snoozed: '已延后',
    ignored_until_audio_returns: '本次已忽略',
    paused: '已暂停',
    error: '异常'
  };

  return labels[status] ?? status;
}

function updateTrayLabel(): string {
  const state = getUpdateState();
  switch (state.status) {
    case 'checking':
      return '正在检查更新...';
    case 'available':
      return state.availableVersion ? `下载更新 ${state.availableVersion}` : '下载更新';
    case 'downloading':
      return state.percent === null ? '正在下载更新...' : `正在下载更新 ${Math.round(state.percent)}%`;
    case 'downloaded':
      return '重启并安装更新';
    case 'error':
      return '检查更新失败，重试';
    case 'unsupported':
      return '检查更新（安装包版本可用）';
    default:
      return '检查更新';
  }
}

function updateTrayEnabled(): boolean {
  const state = getUpdateState();
  return state.status !== 'checking' && state.status !== 'downloading' && state.status !== 'unsupported';
}

async function handleTrayUpdateClick(): Promise<void> {
  showSettingsWindow();
  const state = getUpdateState();
  if (state.status === 'downloaded') {
    installDownloadedUpdate();
    return;
  }

  if (state.status === 'available') {
    await downloadUpdate();
    return;
  }

  await checkForUpdates(true);
}

function isHistoryAction(action: AlertAction): action is AlertHistoryAction {
  return action === 'acknowledge' || action === 'ignore_once';
}

type TrayTone = keyof typeof trayIconPaths;

function trayTone(snapshot: AppSnapshot): TrayTone {
  if (snapshot.alertVisible || snapshot.status === 'alerting') {
    return 'danger';
  }

  if (snapshot.preAlertVisible || snapshot.status === 'pre_alert') {
    return 'warning';
  }

  if (snapshot.status === 'monitoring' || snapshot.status === 'silent_counting') {
    return 'safe';
  }

  return 'idle';
}

function createTrayIcon(tone: TrayTone): Electron.NativeImage {
  if (process.platform === 'darwin') {
    const macIcon = nativeImage.createFromPath(trayMacTemplatePath).resize({ width: 18, height: 18 });
    macIcon.setTemplateImage(true);
    return macIcon;
  }

  const icon = nativeImage.createFromPath(trayIconPaths[tone]);
  if (!icon.isEmpty()) {
    return icon.resize({ width: 16, height: 16 });
  }

  return nativeImage.createFromPath(appIconPath());
}
