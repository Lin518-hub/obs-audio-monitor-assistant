import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConfigStore } from './configStore.js';
import { getDisplays } from './display.js';
import { HistoryStore } from './historyStore.js';
import { OBSMonitor } from './obsMonitor.js';
import type { AlertAction, AlertHistoryAction, AppConfig, AppSnapshot, DisplayInfo, WindowBounds } from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDev = !app.isPackaged;
const shouldUseDevServer = isDev && process.env.npm_lifecycle_event !== 'start';
const rendererUrl = 'http://127.0.0.1:5173';
const appIconPngPath = join(__dirname, '../../../build/icon.png');
const appIconIcoPath = join(__dirname, '../../../build/icon.ico');
const trayMacTemplatePath = join(__dirname, '../../../build/tray-macTemplate.png');
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

if (process.platform === 'win32') {
  app.setAppUserModelId('com.obsaudioassistant.app');
}

let configStore: ConfigStore;
let historyStore: HistoryStore;
let monitor: OBSMonitor;
let settingsWindow: BrowserWindow | null = null;
let isQuitting = false;
let tray: Tray | null = null;
let latestSnapshot: AppSnapshot | null = null;
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
  const config = await configStore.load();
  const history = await historyStore.load();
  monitor = new OBSMonitor(config, getDisplays());
  monitor.setHistory(history);
  latestSnapshot = monitor.getSnapshot();

  registerIpc();
  createTray();
  createSettingsWindow();
  if (latestSnapshot.config.floatingWindowEnabled) {
    showFloatingWindow(latestSnapshot);
  }

  screen.on('display-added', refreshDisplays);
  screen.on('display-removed', refreshDisplays);
  screen.on('display-metrics-changed', refreshDisplays);

  monitor.on('snapshot', (snapshot) => {
    latestSnapshot = snapshot;
    broadcastSnapshot(snapshot);
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
    latestSnapshot = snapshot;
    closePreAlertWindows('destroy');
    showAlertWindows(snapshot);
  });

  await monitor.start();
}

app.on('window-all-closed', () => {
  // Keep the companion app alive in the tray after the settings window closes.
});

app.on('before-quit', () => {
  isQuitting = true;
  void monitor?.stop();
});

function registerIpc(): void {
  ipcMain.handle('snapshot:get', () => latestSnapshot ?? monitor.getSnapshot());
  ipcMain.handle('config:save', async (_event, patch: Partial<AppConfig>) => {
    const nextConfig = await configStore.save({
      ...(latestSnapshot ?? monitor.getSnapshot()).config,
      ...patch
    });
    return monitor.updateConfig(nextConfig);
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
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatingWindow.once('ready-to-show', () => floatingWindow?.showInactive());
  floatingWindow.on('moved', () => {
    saveFloatingWindowBoundsFromWindow();
  });
  floatingWindow.on('resized', () => {
    keepFloatingWindowAspectRatio();
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
