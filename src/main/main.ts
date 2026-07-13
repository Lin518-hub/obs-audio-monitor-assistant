import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray, type Rectangle } from 'electron';
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConfigStore } from './configStore.js';
import { getDisplays } from './display.js';
import { HistoryStore } from './historyStore.js';
import { ATEMHistoryStore } from './atemHistoryStore.js';
import { OBSMonitor } from './obsMonitor.js';
import { ATEMMonitor } from './ATEMMonitor.js';
import { RemoteBridge, remoteServerCandidates, type RemoteCommand } from './RemoteBridge.js';
import { DEFAULT_CONFIG, type AlertAction, type AlertHistoryAction, type AppConfig, type AppSnapshot, type ATEMSwitchHistoryEntry, type AudioMeterFrame, type DisplayInfo, type UpdateSnapshot, type UpdateSource, type WindowBounds } from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDev = !app.isPackaged;
const shouldUseDevServer = isDev && process.env.npm_lifecycle_event === 'dev';
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
const FLOATING_AUDIO_ATEM_DEFAULT_WIDTH = 400;
const FLOATING_AUDIO_ATEM_DEFAULT_HEIGHT = 238;
const FLOATING_MULTI_DEFAULT_WIDTH = 460;
const FLOATING_MULTI_DEFAULT_HEIGHT = 300;
const FLOATING_WINDOW_MIN_WIDTH = 320;
const FLOATING_MULTI_MIN_WIDTH = 380;
const FLOATING_WINDOW_MAX_WIDTH = 640;
const FLOATING_WINDOW_ASPECT_RATIO = FLOATING_WINDOW_DEFAULT_WIDTH / FLOATING_WINDOW_DEFAULT_HEIGHT;
const FLOATING_WINDOW_BASE_RADIUS = 14;
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
let atemHistoryStore: ATEMHistoryStore;
let atemSwitchHistory: ATEMSwitchHistoryEntry[] = [];
let monitor: OBSMonitor;
let atemMonitor: ATEMMonitor;
let remoteBridge: RemoteBridge;
let settingsWindow: BrowserWindow | null = null;
let isQuitting = false;
let tray: Tray | null = null;
let latestSnapshot: AppSnapshot | null = null;
let updateState: UpdateSnapshot | null = null;
let updateCheckInFlight: Promise<UpdateSnapshot> | null = null;
let updateInitialTimer: NodeJS.Timeout | null = null;
let updateCheckTimer: NodeJS.Timeout | null = null;
let downloadedUpdateFilePath: string | null = null;
let alertActionInProgress = false;
let floatingWindow: BrowserWindow | null = null;
let isAdjustingFloatingWindowSize = false;
let lastTrayTone: TrayTone | null = null;
let lastTrayTooltip = '';
let lastTrayMenuKey = '';
const alertWindows = new Map<number, BrowserWindow>();
const alertBackdropWindows = new Map<number, BrowserWindow>();
const toastAlertWindows = new Map<number, BrowserWindow>();
const preAlertWindows = new Map<number, BrowserWindow>();
const rendererUnavailable = new WeakSet<BrowserWindow>();
const rendererReloadTimers = new WeakMap<BrowserWindow, NodeJS.Timeout>();

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
  atemHistoryStore = new ATEMHistoryStore();
  let config = await configStore.load();
  // Persist generated remote UUID/secret and one-time config migrations.
  config = await configStore.save(config);
  const systemAutoLaunchEnabled = getAutoLaunchEnabled();
  if (systemAutoLaunchEnabled && !config.autoLaunch) {
    config = await configStore.save({ ...config, autoLaunch: true });
  } else if (config.autoLaunch) {
    await applyAutoLaunch(true);
  }
  const history = await historyStore.load();
  atemSwitchHistory = await atemHistoryStore.load();
  monitor = new OBSMonitor(config, getDisplays());
  monitor.setHistory(history);

  atemMonitor = new ATEMMonitor();
  remoteBridge = new RemoteBridge();
  latestSnapshot = injectATEMState(monitor.getSnapshot());

  remoteBridge.on('stateChanged', () => {
    if (!latestSnapshot) return;
    latestSnapshot = injectATEMState(latestSnapshot);
    broadcastSnapshot(latestSnapshot);
  });
  remoteBridge.on('command', (command) => {
    void handleRemoteCommand(command);
  });
  remoteBridge.updateSnapshot(latestSnapshot);
  void remoteBridge.configure(config);

  void atemMonitor.setConfig(config.atemEnabled, config.atemHost, config.atemCameraTimeLimitSeconds).then(() => {
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
    const incoming = injectATEMState(snapshot);
    latestSnapshot = preserveSnapshotHistory(incoming);
    broadcastSnapshot(latestSnapshot);
    remoteBridge.updateSnapshot(latestSnapshot);
    updateTray(latestSnapshot);
    syncFloatingWindow(latestSnapshot);
    if (snapshot.preAlertVisible && !snapshot.alertVisible) {
      showPreAlertWindows(snapshot);
    } else {
      closePreAlertWindows('destroy');
    }
    if (!snapshot.alertVisible) {
      closeAlertWindows('destroy');
      closeAlertBackdropWindows('destroy');
      closeToastAlertWindows('destroy');
    }
  });
  monitor.on('meter', (frame) => {
    broadcastMeterFrame(frame);
    remoteBridge.updateMeter(frame);
  });
  monitor.on('alert', (snapshot) => {
    const merged = injectATEMState(snapshot);
    latestSnapshot = merged;
    closePreAlertWindows('destroy');
    showAlertSurfaces(merged);
  });

  atemMonitor.on('stateChanged', () => {
    if (latestSnapshot) {
      const merged = injectATEMState(latestSnapshot);
      latestSnapshot = merged;
      broadcastSnapshot(merged);
      remoteBridge.updateSnapshot(merged);
    }
  });
  atemMonitor.on('switchRecorded', (entry) => {
    void atemHistoryStore.add(entry).then((history) => {
      atemSwitchHistory = history;
      if (!latestSnapshot) return;
      latestSnapshot = injectATEMState(latestSnapshot);
      broadcastSnapshot(latestSnapshot);
      remoteBridge.updateSnapshot(latestSnapshot);
    }).catch((error) => {
      console.error(`[atem-history] failed to save switch: ${error instanceof Error ? error.message : String(error)}`);
    });
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
  void remoteBridge?.stop();
  closeAlertWindows('destroy');
  closeAlertBackdropWindows('destroy');
  closeToastAlertWindows('destroy');
  closePreAlertWindows('destroy');
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
  ipcMain.handle('snapshot:get', () => rendererSnapshot(latestSnapshot ?? monitor.getSnapshot()));
  ipcMain.handle('config:save', async (_event, patch: Partial<AppConfig>) => {
    const previous = (latestSnapshot ?? monitor.getSnapshot()).config;
    const protectedPatch = {
      ...patch,
      remoteDeviceUuid: previous.remoteDeviceUuid,
      remoteDeviceSecret: previous.remoteDeviceSecret
    };
    const nextConfig = await configStore.update(protectedPatch);
    if (Object.hasOwn(patch, 'autoLaunch') && nextConfig.autoLaunch !== previous.autoLaunch) {
      await applyAutoLaunch(nextConfig.autoLaunch);
    }
    const snapshot = await monitor.updateConfig(nextConfig);
    latestSnapshot = injectATEMState(snapshot);
    broadcastSnapshot(latestSnapshot);
    updateTray(latestSnapshot);
    const floatingWindowChanged =
      Object.hasOwn(patch, 'floatingWindowEnabled') ||
      Object.hasOwn(patch, 'floatingWindowBounds') ||
      Object.hasOwn(patch, 'floatingWindowMode') ||
      Object.hasOwn(patch, 'floatingWindowModules');
    if (floatingWindowChanged) {
      if (latestSnapshot.config.floatingWindowEnabled) {
        configureFloatingWindowForMode(latestSnapshot);
      }
      syncFloatingWindow(latestSnapshot);
    }
    if (Object.hasOwn(patch, 'atemEnabled') || Object.hasOwn(patch, 'atemHost') || Object.hasOwn(patch, 'atemCameraTimeLimitSeconds')) {
      void atemMonitor.setConfig(nextConfig.atemEnabled, nextConfig.atemHost, nextConfig.atemCameraTimeLimitSeconds).then(() => {
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
    if (Object.hasOwn(patch, 'remoteAccessEnabled') || Object.hasOwn(patch, 'remoteServerUrl')) {
      void remoteBridge.configure(nextConfig);
    }
    if (Object.hasOwn(patch, 'updateSource') || Object.hasOwn(patch, 'aliyunUpdateBaseUrl') || Object.hasOwn(patch, 'remoteServerUrl')) {
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
    const nextConfig = await configStore.update({ paused });
    const snapshot = injectATEMState(await monitor.updateConfig(nextConfig));
    latestSnapshot = snapshot;
    broadcastSnapshot(snapshot);
    updateTray(snapshot);
    return snapshot;
  });
  ipcMain.handle('monitor:set-simulated-live', (_event, enabled: boolean) => {
    const snapshot = injectATEMState(monitor.setSimulatedLive(enabled));
    latestSnapshot = snapshot;
    broadcastSnapshot(snapshot);
    updateTray(snapshot);
    return snapshot;
  });
  ipcMain.handle('alert:test', () => {
    const snapshot = injectATEMState(monitor.triggerTestAlert());
    latestSnapshot = snapshot;
    closePreAlertWindows('destroy');
    showAlertSurfaces(snapshot);
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
  ipcMain.handle('atem:history-clear', async () => {
    atemSwitchHistory = await atemHistoryStore.clear();
    const merged = injectATEMState(latestSnapshot ?? monitor.getSnapshot());
    latestSnapshot = merged;
    broadcastSnapshot(merged);
    remoteBridge.updateSnapshot(merged);
    return atemSwitchHistory;
  });
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
  ipcMain.handle('atem:scan-network', async (_event, host?: string) => {
    return atemMonitor.scanNetwork(host);
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
  const remote = remoteBridge?.getSnapshot();
  return {
    ...snapshot,
    ...(atem ? {
      atemConnected: atem.connected,
      atemConnectionState: atem.connectionState,
      atemModelName: atem.modelName,
      atemProgramInput: atem.programInput,
      atemPreviewInput: atem.previewInput,
      atemInputIds: atem.inputIds,
      atemInputLabels: atem.inputLabels,
      atemInputCount: atem.inputCount,
      atemProgramInputStartedAt: atem.programInputStartedAt,
      atemProgramInputElapsedSeconds: atem.programInputElapsedSeconds,
      atemProgramInputOverLimit: snapshot.config.atemCameraTimeAlertEnabled && atem.programInputOverLimit,
      atemSwitchHistory
    } : {}),
    ...(remote ? {
      remoteAccessConnectionState: remote.connectionState,
      remoteAccessConnected: remote.connected,
      remoteAccessPairUrl: remote.pairUrl,
      remoteAccessErrorMessage: remote.errorMessage,
      remoteAccessLastConnectedAt: remote.lastConnectedAt
    } : {})
  };
}

async function handleRemoteCommand(command: RemoteCommand): Promise<void> {
  const snapshot = latestSnapshot;
  if (!snapshot?.config.remoteAccessEnabled) {
    remoteBridge.sendCommandResult(command.id, false, '电脑未启用远程访问');
    return;
  }
  try {
    if (command.command === 'atem.preview') {
      const input = Number(command.payload.input);
      if (!snapshot.atemConnected) throw new Error('ATEM 当前未连接');
      if (!Number.isInteger(input) || !snapshot.atemInputIds.includes(input)) throw new Error('目标信号源不可用');
      await atemMonitor.changePreviewInput(input);
      remoteBridge.sendCommandResult(command.id, true, '已选入 PVW');
      return;
    }
    if (command.command === 'atem.auto') {
      if (!snapshot.atemConnected || snapshot.atemPreviewInput <= 0) throw new Error('ATEM 未连接或没有 PVW 信号');
      await atemMonitor.autoTransition();
      remoteBridge.sendCommandResult(command.id, true, 'AUTO 切换已执行');
      return;
    }
    remoteBridge.sendCommandResult(command.id, false, '不支持的远程操作');
  } catch (error) {
    remoteBridge.sendCommandResult(command.id, false, error instanceof Error ? error.message : '远程操作失败');
  }
}

function preserveSnapshotHistory(snapshot: AppSnapshot): AppSnapshot {
  if (snapshot.volumeHistory.length > 0 || !latestSnapshot || latestSnapshot.volumeHistory.length === 0) {
    return snapshot;
  }

  return {
    ...snapshot,
    volumeHistory: latestSnapshot.volumeHistory
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

  for (let i = 1; i <= 8; i++) {
    const accelerator = `num${i}`;
    try {
      globalShortcut.register(accelerator, () => {
        if (latestSnapshot?.atemInputIds.includes(i)) {
          void atem.changePreviewInput(i).catch((error) => {
            console.error(`[ATEM] global preview shortcut failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
      });
    } catch (error) {
      console.error(`[ATEM] failed to register global shortcut ${accelerator}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const registered = globalShortcut.register('Enter', () => {
      const snapshot = latestSnapshot;
      if (snapshot?.atemConnected && snapshot.atemPreviewInput > 0) {
        void atem.autoTransition().catch((error) => {
          console.error(`[ATEM] global AUTO shortcut failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });
    if (!registered) {
      console.warn('[ATEM] global Enter shortcut is already in use by another application');
    }
  } catch (error) {
    console.error(`[ATEM] failed to register global shortcut Enter: ${error instanceof Error ? error.message : String(error)}`);
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
    downloadedUpdateFilePath = null;
    setUpdateState({
      status: 'available',
      availableVersion: info.version ?? null,
      downloadedVersion: null,
      downloadedFilePath: null,
      percent: null,
      errorMessage: null,
      lastCheckedAt: Date.now(),
      message: info.version ? `${state.sourceLabel} 发现新版本 ${info.version}` : `${state.sourceLabel} 发现新版本`
    });
  });
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    const state = getUpdateState();
    downloadedUpdateFilePath = null;
    setUpdateState({
      status: 'not_available',
      availableVersion: info.version ?? null,
      downloadedVersion: null,
      downloadedFilePath: null,
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
    const manualInstall = usesManualMacInstall();
    setUpdateState({
      status: 'downloaded',
      availableVersion: version,
      downloadedVersion: version,
      downloadedFilePath: downloadedUpdateFilePath,
      installMode: manualInstall ? 'manual' : 'auto',
      percent: 100,
      errorMessage: null,
      message: manualInstall
        ? (version ? `新版本 ${version} 已下载，请打开安装包完成替换` : '更新已下载，请打开安装包完成替换')
        : (version ? `新版本 ${version} 已下载，重启后安装` : '更新已下载，重启后安装')
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
    downloadedFilePath: null,
    installMode: usesManualMacInstall() ? 'manual' : 'auto',
    percent: null,
    message: isUpdaterSupported() ? '可检查更新' : '打包安装后可检查更新',
    lastCheckedAt: null,
    errorMessage: null
  };
}

function isUpdaterSupported(): boolean {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');
}

function usesManualMacInstall(): boolean {
  return process.platform === 'darwin';
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
      downloadedFilePath: null,
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
            downloadedFilePath: null,
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
  downloadedUpdateFilePath = null;
  setUpdateState({
    status: isUpdaterSupported() ? 'idle' : 'unsupported',
    source: source.id,
    sourceLabel: source.label,
    sourceUrl: source.url,
    attemptedSources: [],
    availableVersion: null,
    downloadedVersion: null,
    downloadedFilePath: null,
    percent: null,
    errorMessage: null,
    message: isUpdaterSupported() ? `更新源已切换为 ${source.label}` : '打包安装后可检查更新'
  });
}

function resolveConfiguredUpdateSource(config = currentUpdateConfig()): UpdateSourceInfo {
  if (config.updateSource === 'auto') {
    return {
      id: 'auto',
      label: '自动选择（内部服务器优先）',
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
  const internalUpdateUrls = remoteServerCandidates(config.remoteServerUrl)
    .map((serverUrl) => normalizeUpdateBaseUrl(`${serverUrl}/updates`))
    .filter(Boolean);
  const candidates: UpdateCandidate[] = [];

  if (config.updateSource === 'lan' || includeFallbacks) {
    for (const [index, updateUrl] of internalUpdateUrls.entries()) {
      candidates.push(genericUpdateCandidate(
        'lan',
        internalUpdateUrls.length > 1
          ? `直播间内部更新服务器（${index === 0 ? '局域网' : '公网'}）`
          : '直播间内部更新服务器',
        updateUrl
      ));
    }
  }

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
    aliyun: '阿里云 OSS/CDN 镜像',
    lan: '直播间内部更新服务器'
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
    const downloadedFiles = await autoUpdater.downloadUpdate();
    downloadedUpdateFilePath = pickDownloadedUpdateFile(downloadedFiles);
    if (getUpdateState().status === 'downloaded') {
      const version = getUpdateState().downloadedVersion ?? getUpdateState().availableVersion;
      setUpdateState({
        downloadedFilePath: downloadedUpdateFilePath,
        installMode: usesManualMacInstall() ? 'manual' : 'auto',
        message: usesManualMacInstall()
          ? (version ? `新版本 ${version} 已下载，请打开安装包完成替换` : '更新已下载，请打开安装包完成替换')
          : (version ? `新版本 ${version} 已下载，重启后安装` : '更新已下载，重启后安装')
      });
    }
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

  if (usesManualMacInstall()) {
    const filePath = downloadedUpdateFilePath ?? current.downloadedFilePath;
    if (filePath) {
      shell.showItemInFolder(filePath);
      return setUpdateState({
        message: '已在 Finder 中显示安装包。请解压后将新版 App 拖入“应用程序”并替换旧版本。'
      });
    }

    return setUpdateState({
      status: 'error',
      errorMessage: '找不到已下载的更新包，请重新下载',
      message: '找不到已下载的更新包，请重新下载'
    });
  }

  isQuitting = true;
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });
  return current;
}

function pickDownloadedUpdateFile(paths: string[] | string | null | undefined): string | null {
  const list = Array.isArray(paths) ? paths : typeof paths === 'string' ? [paths] : [];
  if (list.length === 0) {
    return null;
  }

  return list.find((item) => /\.(zip|dmg|exe|msi)$/i.test(item)) ?? list[0] ?? null;
}

function formatUpdateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/code signature|did not pass validation|ShipIt|签名/i.test(raw)) {
    return 'macOS 自动替换需要签名安装包。当前版本已改为下载后手动打开安装包，请重新下载新版。';
  }

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
    width: 975,
    height: 749,
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
      nodeIntegration: false,
      sandbox: true
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
    return;
  }

  const bounds = resolveFloatingWindowBounds(snapshot);
  const mode = snapshot.config.floatingWindowMode;
  const minWidth = floatingWindowMinWidthForMode(mode);
  const fixedAspectRatio = floatingWindowAspectRatio(mode);
  floatingWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth,
    minHeight: floatingWindowHeightForMode(mode, minWidth, snapshot.config.floatingWindowModules),
    maxWidth: FLOATING_WINDOW_MAX_WIDTH,
    maxHeight: fixedAspectRatio ? floatingWindowHeightForMode(mode, FLOATING_WINDOW_MAX_WIDTH, snapshot.config.floatingWindowModules) : 520,
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
      nodeIntegration: false,
      sandbox: true
    }
  });

  attachWindowDiagnostics(floatingWindow, 'floating');
  floatingWindow.setAlwaysOnTop(true, 'floating');
  if (fixedAspectRatio) {
    floatingWindow.setAspectRatio(fixedAspectRatio);
  }
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
    if (!floatingWindow || floatingWindow.isDestroyed()) {
      showFloatingWindow(snapshot);
    }
    return;
  }

  closeFloatingWindow('destroy');
}

async function setFloatingWindowVisible(visible: boolean): Promise<AppSnapshot> {
  const snapshot = latestSnapshot ?? monitor.getSnapshot();
  const nextConfig = await configStore.update({ floatingWindowEnabled: visible });
  const nextSnapshot = await monitor.updateConfig(nextConfig);
  latestSnapshot = injectATEMState(nextSnapshot);

  if (visible) {
    syncFloatingWindow(latestSnapshot);
  } else {
    closeFloatingWindow('destroy');
  }

  updateTray(latestSnapshot);
  broadcastSnapshot(latestSnapshot);
  return latestSnapshot;
}

async function resetToFactoryDefaults(): Promise<AppSnapshot> {
  closeAlertWindows('destroy');
  closeAlertBackdropWindows('destroy');
  closeToastAlertWindows('destroy');
  closePreAlertWindows('destroy');
  closeFloatingWindow('destroy');

  await historyStore.clear();
  atemSwitchHistory = await atemHistoryStore.clear();
  monitor.setHistory([]);
  monitor.resetTransientState();
  await applyAutoLaunch(false);

  const nextConfig = await configStore.reset();
  const nextSnapshot = await monitor.updateConfig(nextConfig);
  latestSnapshot = injectATEMState(nextSnapshot);
  await remoteBridge.configure(nextConfig);
  await atemMonitor.setConfig(nextConfig.atemEnabled, nextConfig.atemHost, nextConfig.atemCameraTimeLimitSeconds);
  latestSnapshot = injectATEMState(monitor.getSnapshot());
  syncATEMHotkeys();

  updateTray(latestSnapshot);
  broadcastSnapshot(latestSnapshot);
  return latestSnapshot;
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

  const nextConfig = await configStore.update({ floatingWindowBounds: bounds });
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
        nodeIntegration: false,
        sandbox: true
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

function showAlertSurfaces(snapshot: AppSnapshot): void {
  const mode = snapshot.config.alertReminderMode;
  if (mode === 'fullscreen') {
    showAlertBackdropWindows(snapshot);
  } else {
    closeAlertBackdropWindows('destroy');
  }
  showAlertWindows(snapshot);
  closeToastAlertWindows('destroy');
}

function showAlertBackdropWindows(snapshot: AppSnapshot): void {
  closeAlertBackdropWindows('destroy');
  const displays = selectAlertDisplays(snapshot.config.alertDisplayMode, snapshot.config.alertDisplayId, snapshot.displays);

  for (const display of displays) {
    const backdropWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      hasShadow: false,
      icon: appIconPath(),
      skipTaskbar: true,
      frame: false,
      show: false,
      focusable: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    backdropWindow.setAlwaysOnTop(true, 'floating');
    backdropWindow.setIgnoreMouseEvents(true);
    backdropWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    backdropWindow.once('ready-to-show', () => backdropWindow.showInactive());
    backdropWindow.on('closed', () => {
      alertBackdropWindows.delete(display.id);
    });
    alertBackdropWindows.set(display.id, backdropWindow);
    loadRendererSafely(backdropWindow, '#alert-backdrop', `alert-backdrop:${display.id}`);
  }
}

function showToastAlertWindows(snapshot: AppSnapshot): void {
  closeToastAlertWindows('destroy');
  const displays = selectAlertDisplays(snapshot.config.alertDisplayMode, snapshot.config.alertDisplayId, snapshot.displays);

  for (const display of displays) {
    const width = Math.min(480, Math.floor(display.bounds.width * 0.72));
    const height = 168;
    const x = display.bounds.x + Math.round((display.bounds.width - width) / 2);
    const y = display.bounds.y + Math.round(display.bounds.height * 0.36);

    const toastWindow = new BrowserWindow({
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
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    attachWindowDiagnostics(toastWindow, `toast-alert:${display.id}`);
    toastWindow.setAlwaysOnTop(true, 'floating');
    toastWindow.once('ready-to-show', () => toastWindow.showInactive());
    toastWindow.on('closed', () => {
      toastAlertWindows.delete(display.id);
    });
    toastAlertWindows.set(display.id, toastWindow);
    loadRendererSafely(toastWindow, '#toast-alert', `toast-alert:${display.id}`);
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
        nodeIntegration: false,
        sandbox: true
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

function closeAlertBackdropWindows(mode: 'close' | 'destroy' = 'destroy'): void {
  for (const window of alertBackdropWindows.values()) {
    safelyCloseWindow(window, mode);
  }
  alertBackdropWindows.clear();
}

function closeToastAlertWindows(mode: 'close' | 'destroy' = 'destroy'): void {
  for (const window of toastAlertWindows.values()) {
    safelyCloseWindow(window, mode);
  }
  toastAlertWindows.clear();
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
    closeAlertBackdropWindows('destroy');
    closeToastAlertWindows('destroy');
    closePreAlertWindows('destroy');
    monitor.handleAlertAction(action);

    if (shouldRecord) {
      try {
        const history = await historyStore.add({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          inputName: before.activeInputName || before.config.targetInputName || '目标音源',
          silentForSeconds: before.silentForSeconds,
          action,
          status: before.status
        });
        monitor.setHistory(history);
      } catch (error) {
        console.error(`[history] failed to write alert action: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    latestSnapshot = injectATEMState(monitor.getSnapshot());
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
  const tone = trayTone(snapshot);
  const tooltip = `OBS 音频检测助手 - ${statusText}`;
  const menuKey = [
    statusText,
    snapshot.config.floatingWindowEnabled,
    snapshot.config.paused,
    updateState?.status ?? 'idle',
    updateState?.availableVersion ?? ''
  ].join('|');

  if (lastTrayTone !== tone) {
    tray.setImage(createTrayIcon(tone));
    lastTrayTone = tone;
  }
  if (lastTrayTooltip !== tooltip) {
    tray.setToolTip(tooltip);
    lastTrayTooltip = tooltip;
  }
  if (lastTrayMenuKey === menuKey) {
    return;
  }

  lastTrayMenuKey = menuKey;
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
            const nextConfig = await configStore.update({ paused: !snapshot.config.paused });
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
  const safeSnapshot = rendererSnapshot(snapshot);
  BrowserWindow.getAllWindows().forEach((window) => {
    sendToWindow(window, 'snapshot', safeSnapshot);
  });
}

function broadcastMeterFrame(frame: AudioMeterFrame): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    sendToWindow(window, 'meter:update', frame);
  });
}

function rendererSnapshot(snapshot: AppSnapshot): AppSnapshot {
  return {
    ...snapshot,
    config: {
      ...snapshot.config,
      remoteDeviceSecret: ''
    }
  };
}

function broadcastUpdateState(): void {
  if (!updateState) {
    return;
  }

  BrowserWindow.getAllWindows().forEach((window) => {
    sendToWindow(window, 'update:state', updateState);
  });
}

function sendToWindow(window: BrowserWindow, channel: string, payload: unknown): void {
  if (rendererUnavailable.has(window) || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }

  try {
    window.webContents.send(channel, payload);
  } catch (error) {
    // A renderer can disappear between the lifecycle check and send(), for
    // example during Vite reload or a crash. Do not let that break monitoring.
    rendererUnavailable.add(window);
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      console.warn(`[ipc] failed to send ${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function attachWindowDiagnostics(window: BrowserWindow, label: string): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on('did-finish-load', () => {
    rendererUnavailable.delete(window);
    const timer = rendererReloadTimers.get(window);
    if (timer) {
      clearTimeout(timer);
      rendererReloadTimers.delete(window);
    }
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`[${label}] failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererUnavailable.add(window);
    console.error(`[${label}] renderer gone: ${details.reason}`);
    if (isQuitting || window.isDestroyed() || rendererReloadTimers.has(window)) {
      return;
    }

    const timer = setTimeout(() => {
      rendererReloadTimers.delete(window);
      if (!isQuitting && !window.isDestroyed()) {
        rendererUnavailable.delete(window);
        window.reload();
      }
    }, 750);
    rendererReloadTimers.set(window, timer);
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

  const nextConfig = await configStore.update((current) => ({
    alertPositions: {
      ...current.alertPositions,
      [String(displayId)]: position
    }
  }));
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
  const mode = snapshot.config.floatingWindowMode;
  const defaultWidth = mode === 'audio'
    ? FLOATING_WINDOW_DEFAULT_WIDTH
    : mode === 'audio_atem'
      ? FLOATING_AUDIO_ATEM_DEFAULT_WIDTH
      : FLOATING_MULTI_DEFAULT_WIDTH;
  const minWidth = floatingWindowMinWidthForMode(mode);
  const width = saved
    ? clamp(saved.width, minWidth, FLOATING_WINDOW_MAX_WIDTH)
    : defaultWidth;
  const height = mode !== 'multifunction'
    ? floatingWindowHeightForMode(mode, width, snapshot.config.floatingWindowModules)
    : Math.max(FLOATING_MULTI_DEFAULT_HEIGHT, saved?.height ?? FLOATING_MULTI_DEFAULT_HEIGHT);
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

function floatingWindowHeightForMode(
  mode: AppConfig['floatingWindowMode'],
  width: number,
  modules: AppConfig['floatingWindowModules']
): number {
  if (mode === 'audio') {
    return Math.round(width / FLOATING_WINDOW_ASPECT_RATIO);
  }
  if (mode === 'audio_atem') {
    return Math.round(width / (FLOATING_AUDIO_ATEM_DEFAULT_WIDTH / FLOATING_AUDIO_ATEM_DEFAULT_HEIGHT));
  }

  const moduleCount = countFloatingModules(modules);
  if (moduleCount <= 1) return 220;
  if (moduleCount === 2) return 250;
  return 300;
}

function countFloatingModules(modules: AppConfig['floatingWindowModules']): number {
  return Number(modules.audio) + Number(modules.atem) + Number(modules.obsStats);
}

function floatingWindowMinWidthForMode(mode: AppConfig['floatingWindowMode']): number {
  return mode === 'multifunction' ? FLOATING_MULTI_MIN_WIDTH : FLOATING_WINDOW_MIN_WIDTH;
}

function floatingWindowAspectRatio(mode: AppConfig['floatingWindowMode']): number | null {
  if (mode === 'audio') return FLOATING_WINDOW_ASPECT_RATIO;
  if (mode === 'audio_atem') return FLOATING_AUDIO_ATEM_DEFAULT_WIDTH / FLOATING_AUDIO_ATEM_DEFAULT_HEIGHT;
  return null;
}

function configureFloatingWindowForMode(snapshot: AppSnapshot): void {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    return;
  }

  const mode = snapshot.config.floatingWindowMode;
  const bounds = floatingWindow.getBounds();
  const minWidth = floatingWindowMinWidthForMode(mode);
  const width = clamp(bounds.width, minWidth, FLOATING_WINDOW_MAX_WIDTH);
  const minHeight = floatingWindowHeightForMode(mode, minWidth, snapshot.config.floatingWindowModules);
  const fixedAspectRatio = floatingWindowAspectRatio(mode);
  const maxHeight = fixedAspectRatio ? floatingWindowHeightForMode(mode, FLOATING_WINDOW_MAX_WIDTH, snapshot.config.floatingWindowModules) : 520;
  const height = fixedAspectRatio
    ? floatingWindowHeightForMode(mode, width, snapshot.config.floatingWindowModules)
    : clamp(floatingWindowHeightForMode(mode, width, snapshot.config.floatingWindowModules), minHeight, maxHeight);

  floatingWindow.setMinimumSize(minWidth, minHeight);
  floatingWindow.setMaximumSize(FLOATING_WINDOW_MAX_WIDTH, maxHeight);
  try {
    floatingWindow.setAspectRatio(fixedAspectRatio ?? 0);
  } catch {
    // Older Electron builds may not support clearing the aspect ratio with 0.
  }

  if (bounds.width !== width || bounds.height !== height) {
    isAdjustingFloatingWindowSize = true;
    floatingWindow.setBounds({ ...bounds, width, height }, false);
    isAdjustingFloatingWindowSize = false;
  }
  floatingWindow.setAlwaysOnTop(true, 'floating');
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyFloatingWindowShape();
}

function keepFloatingWindowAspectRatio(): void {
  if (!floatingWindow || floatingWindow.isDestroyed() || isAdjustingFloatingWindowSize) {
    return;
  }

  const mode = latestSnapshot?.config.floatingWindowMode ?? 'audio';
  if (!floatingWindowAspectRatio(mode)) {
    return;
  }

  const bounds = floatingWindow.getBounds();
  const width = clamp(bounds.width, FLOATING_WINDOW_MIN_WIDTH, FLOATING_WINDOW_MAX_WIDTH);
  const height = floatingWindowHeightForMode(mode, width, latestSnapshot?.config.floatingWindowModules ?? DEFAULT_CONFIG.floatingWindowModules);
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
  const radius = Math.min(Math.round(FLOATING_WINDOW_BASE_RADIUS * (width / FLOATING_WINDOW_DEFAULT_WIDTH)), Math.floor(width / 2), Math.floor(height / 2));
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
      return state.installMode === 'manual' ? '打开已下载的安装包' : '重启并安装更新';
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
