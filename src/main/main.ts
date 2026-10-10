import { offlineRendererUrlAllowed } from '../shared/offlineNetwork.js';
import { ProjectorSafetyOverlay } from './projectorSafetyOverlay.js';
import { SingleFlight } from '../shared/singleFlight.js';
import { confirmLayoutWindow } from './confirmLayoutWindow.js';
import { LaunchOverlay } from './launchOverlay.js';
import { preflightError } from '../shared/preflightErrors.js';
import { resizeFloatingBounds } from '../shared/floatingResize.js';
import { app, session, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConfigStore } from './configStore.js';
import { getDisplays } from './display.js';
import { HistoryStore } from './historyStore.js';
import { ATEMHistoryStore } from './atemHistoryStore.js';
import { ATEMSessionStore } from './ATEMSessionStore.js';
import { OBSMonitor } from './obsMonitor.js';
import { ATEMMonitor } from './ATEMMonitor.js';
import { PreflightCheckService } from './preflightCheck.js';
import { crashRestartArgs } from './crashRecovery.js';
import { installFileLogger } from './fileLogger.js';
import { rendererSnapshot } from './rendererSnapshot.js';
import { RuntimeDiagnosticsStore } from './runtimeDiagnostics.js';
import { roundedWindowShape, type WindowShapeRectangle } from './windowShape.js';
import { defaultATEMInputColor } from '../shared/atemPalette.js';
import { isPreflightAppId } from '../shared/preflight.js';
import { DEFAULT_CONFIG, PREFLIGHT_APP_IDS, type AlertAction, type AppConfig, type AppSnapshot, type ATEMLiveSession, type ATEMSessionSegment, type ATEMSwitchHistoryEntry, type AudioMeterFrame, type DisplayInfo, type PreflightAppConfigs, type PreflightPathSource, type PreflightProjectorResult, type PreflightSettings, type PreflightWindowPlacement, type PreflightWindowPlacements, type RemoteAdminCommand, type RemoteAdminCommandResult, type UpdateSnapshot, type UpdateSource, type WindowBounds } from '../shared/types.js';

// GUI/background launches can outlive the terminal that originally owned
// stdout/stderr. Diagnostic writes must not crash Electron after that pipe closes.
for (const stream of [process.stdout, process.stderr]) {
  stream?.on('error', (_error: NodeJS.ErrnoException) => undefined);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDev = !app.isPackaged;
const shouldUseDevServer = isDev && process.env.npm_lifecycle_event === 'dev';
const rendererUrl = 'http://127.0.0.1:5173';
let preflightBusy = false;
const preparationFlight = new SingleFlight<import('../shared/types.js').PreflightLaunchResult>();
let alertsMutedUntil = 0;
let muteExpiryTimer: NodeJS.Timeout | null = null;
function setTemporaryMute(minutes: number): void {
  if (muteExpiryTimer) clearTimeout(muteExpiryTimer);
  muteExpiryTimer = null;
  alertsMutedUntil = minutes ? Date.now() + minutes * 60_000 : 0;
  if (minutes) { muteExpiryTimer = setTimeout(() => setTemporaryMute(0), minutes * 60_000); muteExpiryTimer.unref(); }
  const previous = latestSnapshot;
  latestSnapshot = injectATEMState(monitor.getSnapshot());
  broadcastSnapshot(latestSnapshot);
  syncAlertSurfaces(previous, latestSnapshot);
  syncPreAlertSurfaces(latestSnapshot);
}

const launchOverlay = new LaunchOverlay(join(__dirname, 'preload.cjs'), window => loadRendererSafely(window, '#launch-overlay', 'launch-overlay'), releasePreflightControl);
function releasePreflightControl(): void {
  preflightCheckService.cancel();
  launchOverlay.close();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('preflight:control-released');
  }
}
async function runPreflight<T>(action: () => Promise<T>, cover = false): Promise<T> {
  if (preflightBusy) throw new Error('已有开播操作正在执行，请等待结束');
  preflightBusy = true;
  preflightCheckService.begin();
  try {
    if (cover) launchOverlay.show();
    const result = await action();
    preflightCheckService.assertActive();
    return result;
  } catch (error) {
    console.error('[preflight]', error);
    throw new Error(preflightError(error));
  } finally { launchOverlay.close(); preflightBusy = false; }
}

const appIconPngPath = join(__dirname, '../../../build/icon.png');
const appIconIcoPath = join(__dirname, '../../../build/icon.ico');
const trayMacTemplatePath = join(__dirname, '../../../build/tray-macTemplate.png');
const autoLaunchArgs = ['--autostart-preflight'];
const launchPreflight = process.argv.includes('--autostart-preflight') || process.argv.includes('--hidden');
const launchHidden = process.argv.includes('--background');
const trayIconPaths = {
  safe: join(__dirname, '../../../build/tray-safe.png'),
  warning: join(__dirname, '../../../build/tray-warning.png'),
  danger: join(__dirname, '../../../build/tray-danger.png'),
  idle: join(__dirname, '../../../build/tray-idle.png')
} as const;
const FLOATING_WINDOW_DEFAULT_WIDTH = 340;
const FLOATING_WINDOW_DEFAULT_HEIGHT = 178;
const FLOATING_AUDIO_ATEM_DEFAULT_WIDTH = 340;
const FLOATING_AUDIO_ATEM_DEFAULT_HEIGHT = 178;
const FLOATING_AUDIO_ATEM_MIN_WIDTH = 320;
const FLOATING_MULTI_DEFAULT_WIDTH = 460;
const FLOATING_MULTI_DEFAULT_HEIGHT = 300;
const FLOATING_WINDOW_MIN_WIDTH = 320;
const FLOATING_MULTI_MIN_WIDTH = 380;
const FLOATING_WINDOW_MAX_WIDTH = 640;
const FLOATING_WINDOW_ASPECT_RATIO = FLOATING_WINDOW_DEFAULT_WIDTH / FLOATING_WINDOW_DEFAULT_HEIGHT;
const FLOATING_WINDOW_BASE_RADIUS = 14;
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const UPDATE_INITIAL_CHECK_DELAY_MS = 12 * 1000;

app.setName('OBS 音频检测助手 离线版');
app.setPath('userData', join(app.getPath('appData'), 'obs-audio-monitor-offline'));

const runtimeDiagnostics = new RuntimeDiagnosticsStore(join(app.getPath('userData'), 'runtime-error.json'));
const mainLogger = installFileLogger({
  directory: join(app.getPath('userData'), 'logs'),
  onError: (message) => {
    const summary = runtimeDiagnostics.record('main_log_error', 'main', message);
  }
});
let handlingFatalMainError = false;

process.once('uncaughtException', (error) => {
  handleFatalMainError(error, 'uncaught_exception');
});
process.once('unhandledRejection', (reason) => {
  handleFatalMainError(reason, 'unhandled_rejection');
});

if (process.platform === 'win32') {
  app.setAppUserModelId('com.obsaudioassistant.app');
}

const projectorSafetyOverlay = new ProjectorSafetyOverlay();
let configStore: ConfigStore;
let historyStore: HistoryStore;
let atemHistoryStore: ATEMHistoryStore;
let atemSessionStore: ATEMSessionStore;
let atemSwitchHistory: ATEMSwitchHistoryEntry[] = [];
let atemCurrentSession: ATEMLiveSession | null = null;
let atemRecentSessions: ATEMLiveSession[] = [];
let atemSessionQueue: Promise<void> = Promise.resolve();
let atemSessionTransitionPending = false;
let pendingATEMSessionStop: { endedAt: number; state: ReturnType<ATEMMonitor['getSnapshot']> } | null = null;
let monitor: OBSMonitor;
let atemMonitor: ATEMMonitor;
let preflightCheckService: PreflightCheckService;
let settingsWindow: BrowserWindow | null = null;
let isQuitting = false;
let tray: Tray | null = null;
let latestSnapshot: AppSnapshot | null = null;
let alertActionInProgress = false;
let floatingWindow: BrowserWindow | null = null;
let monitoringPromptWindow: BrowserWindow | null = null;
let monitoringPromptDeadline = 0;
let floatingDrag: { bounds: Electron.Rectangle; cursor: Electron.Point; edge: string } | null = null;
let isAdjustingFloatingWindowSize = false;
let floatingTopmostTimer: NodeJS.Timeout | null = null;
let floatingResizeSettleTimer: NodeJS.Timeout | null = null;
let floatingShapeTimer: NodeJS.Timeout | null = null;
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
      handleFatalMainError(error, 'initialization_failed');
    });
  });
}

async function initializeApp(): Promise<void> {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({cancel: !offlineRendererUrlAllowed(details.url)});
  });
  Menu.setApplicationMenu(null);
  if (process.platform === 'darwin') {
    app.dock?.setIcon(appIconPngPath);
  }
  configStore = new ConfigStore();
  historyStore = new HistoryStore();
  atemHistoryStore = new ATEMHistoryStore();
  atemSessionStore = new ATEMSessionStore();
  let config = await configStore.load();
  const systemAutoLaunchEnabled = getAutoLaunchEnabled();
  if (systemAutoLaunchEnabled && !config.autoLaunch) {
    config = { ...config, autoLaunch: true };
  } else if (config.autoLaunch && !systemAutoLaunchEnabled) {
    void applyAutoLaunch(true);
  }
  // Persist generated UUIDs and migrations without holding the first visible
  // window behind disk encryption or login-item reconciliation.
  void configStore.save(config).catch((error) => {
    console.error(`[config] failed to persist startup config: ${error instanceof Error ? error.message : String(error)}`);
  });
  const persistedStatePromise = Promise.all([
    historyStore.load(),
    atemHistoryStore.load(),
    atemSessionStore.load()
  ]);
  monitor = new OBSMonitor(config, getDisplays());
  projectorSafetyOverlay.configure(config.projectorSafety);

  atemMonitor = new ATEMMonitor();
  preflightCheckService = new PreflightCheckService();
  latestSnapshot = injectATEMState(monitor.getSnapshot());

  void atemMonitor.setConfig(
    config.atemEnabled,
    config.atemHost,
    config.atemCameraTimeLimitSeconds,
    config.atemCameraTimeAlertEnabled,
    config.atemPrimaryInputIds
  ).then(() => {
    const merged = injectATEMState(monitor.getSnapshot());
    latestSnapshot = merged;
    broadcastSnapshot(merged);
  });

  registerIpc();
  if (!launchHidden) {
    createSettingsWindow(launchPreflight ? 'preflight' : undefined);
  }
  createTray();
  if (latestSnapshot.config.floatingWindowEnabled) {
    showFloatingWindow(latestSnapshot);
  }

  screen.on('display-added', refreshDisplays);
  screen.on('display-removed', refreshDisplays);
  screen.on('display-metrics-changed', refreshDisplays);

  monitor.on('snapshot', (snapshot) => {
    const previousSnapshot = latestSnapshot;
    const monitoringActive = snapshot.monitoringActive;
    const previousMonitoringActive = latestSnapshot?.monitoringActive ?? false;
    if (!monitoringActive && (previousMonitoringActive || atemCurrentSession) && !pendingATEMSessionStop) {
      // Capture the final interval before setLiveActive(false) resets the
      // visible timer. The session store still needs this last camera span.
      pendingATEMSessionStop = { endedAt: Date.now(), state: atemMonitor.getSnapshot() };
    }
    atemMonitor.setLiveActive(monitoringActive);
    const incoming = injectATEMState(snapshot);
    latestSnapshot = preserveSnapshotHistory(incoming);
    broadcastSnapshot(latestSnapshot);
    updateTray(latestSnapshot);
    syncFloatingWindow(latestSnapshot);
    if (!snapshot.virtualCameraActive || !snapshot.connected || snapshot.monitoringActive) {
      monitoringPromptWindow?.close();
    } else if (!previousSnapshot?.virtualCameraActive) {
      showMonitoringPrompt();
    }
    syncATEMLiveSession(snapshot);
    syncPreAlertSurfaces(latestSnapshot);
    syncAlertSurfaces(previousSnapshot, latestSnapshot);
  });
  monitor.on('meter', (frame) => {
    broadcastMeterFrame(frame);
  });
  monitor.on('alert', (snapshot) => {
    const previousSnapshot = latestSnapshot;
    const merged = injectATEMState(snapshot);
    latestSnapshot = merged;
    syncAlertSurfaces(previousSnapshot, merged);
  });

  atemMonitor.on('stateChanged', () => {
    if (latestSnapshot) {
      const previousSnapshot = latestSnapshot;
      const merged = injectATEMState(latestSnapshot);
      latestSnapshot = merged;
      broadcastSnapshot(merged);
      updateTray(merged);
      syncFloatingWindow(merged);
      syncPreAlertSurfaces(merged);
      syncAlertSurfaces(previousSnapshot, merged);
    }
  });
  atemMonitor.on('switchRecorded', (entry) => {
    atemSessionQueue = atemSessionQueue.catch(() => undefined).then(async () => {
      atemSwitchHistory = await atemHistoryStore.add(entry);
      if (atemCurrentSession) {
        const sessions = await atemSessionStore.addSegment(sessionSegmentFromSwitch(entry));
        atemCurrentSession = sessions.activeSession;
        atemRecentSessions = sessions.sessions;
      }
      if (!latestSnapshot) return;
      latestSnapshot = injectATEMState(latestSnapshot);
      broadcastSnapshot(latestSnapshot);
    }).catch((error) => {
      console.error(`[atem-session] failed to record camera switch: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  const [history, loadedATEMSwitchHistory, storedSessions] = await persistedStatePromise;
  monitor.setHistory(history);
  atemSwitchHistory = loadedATEMSwitchHistory;
  atemCurrentSession = storedSessions.activeSession;
  atemRecentSessions = storedSessions.sessions;
  latestSnapshot = injectATEMState(monitor.getSnapshot());
  broadcastSnapshot(latestSnapshot);

  await monitor.start();
}

app.on('window-all-closed', () => {
  // Keep the companion app alive in the tray after the settings window closes.
});

app.on('before-quit', () => {
  isQuitting = true;
  projectorSafetyOverlay.destroy();
  void mainLogger.flush();
  void monitor?.stop();
  void atemMonitor?.stop();
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
      openAsHidden: false,
      path: process.execPath,
      args: enabled ? autoLaunchArgs : []
    });
  } catch (error) {
    console.error(`[auto-launch] failed to update setting: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function registerIpc(): void {
  ipcMain.handle('snapshot:get', (event) => rendererSnapshot(
    latestSnapshot ?? monitor.getSnapshot(),
    settingsWindow?.webContents.id === event.sender.id
  ));
  ipcMain.handle('projector-safety:status', () => projectorSafetyOverlay.getStatus());
  ipcMain.handle('projector-safety:select', (_event, handle: string) => projectorSafetyOverlay.select(String(handle)));
  ipcMain.handle('projector-safety:preview', (_event, config) => projectorSafetyOverlay.preview(config));
  ipcMain.handle('config:save', async (_event, patch: Partial<AppConfig>) => {
    const previousSnapshot = latestSnapshot ?? monitor.getSnapshot();
    const previous = previousSnapshot.config;
    const nextConfig = await configStore.update((current) => {
      const requestedRoomName = Object.hasOwn(patch, 'livestreamRoomName')
        ? String(patch.livestreamRoomName ?? '').trim()
        : current.livestreamRoomName;
      const roomNameChanged = requestedRoomName !== current.livestreamRoomName;
      return {
        ...patch,
        ...(Object.hasOwn(patch, 'floatingWindowMode') && patch.floatingWindowMode !== current.floatingWindowMode
          ? { floatingWindowBounds: null }
          : {}),
        livestreamRoomNameRevision: roomNameChanged
          ? current.livestreamRoomNameRevision + 1
          : current.livestreamRoomNameRevision,
        remoteDeviceUuid: current.remoteDeviceUuid,
        remoteDeviceSecret: current.remoteDeviceSecret
      };
    });
    projectorSafetyOverlay.configure(nextConfig.projectorSafety);
    if (Object.hasOwn(patch, 'autoLaunch') && nextConfig.autoLaunch !== previous.autoLaunch) {
      await applyAutoLaunch(nextConfig.autoLaunch);
    }
    const snapshot = await monitor.updateConfig(nextConfig);
    latestSnapshot = injectATEMState(snapshot);
    broadcastSnapshot(latestSnapshot);
    updateTray(latestSnapshot);
    syncPreAlertSurfaces(latestSnapshot);
    syncAlertSurfaces(previousSnapshot, latestSnapshot);
    const floatingWindowChanged =
      Object.hasOwn(patch, 'floatingWindowLocked') ||
      Object.hasOwn(patch, 'floatingWindowOpacity') ||
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
    if (Object.hasOwn(patch, 'atemEnabled') || Object.hasOwn(patch, 'atemHost') || Object.hasOwn(patch, 'atemCameraTimeLimitSeconds') || Object.hasOwn(patch, 'atemCameraTimeAlertEnabled') || Object.hasOwn(patch, 'atemPrimaryInputId') || Object.hasOwn(patch, 'atemPrimaryInputIds')) {
      void atemMonitor.setConfig(
        nextConfig.atemEnabled,
        nextConfig.atemHost,
        nextConfig.atemCameraTimeLimitSeconds,
        nextConfig.atemCameraTimeAlertEnabled,
        nextConfig.atemPrimaryInputIds
      ).then(() => {
        if (latestSnapshot) {
          const previousATEMSnapshot = latestSnapshot;
          const merged = injectATEMState(latestSnapshot);
          latestSnapshot = merged;
          broadcastSnapshot(merged);
          syncPreAlertSurfaces(merged);
          syncAlertSurfaces(previousATEMSnapshot, merged);
        }
        syncATEMHotkeys();
      });
    }
    if (Object.hasOwn(patch, 'atemHotkeyGlobal')) {
      syncATEMHotkeys();
    }
    if (Object.hasOwn(patch, 'centralMonitoringEnabled') || Object.hasOwn(patch, 'remoteAccessEnabled') || Object.hasOwn(patch, 'developerModeEnabled') || Object.hasOwn(patch, 'remoteServerUrl') || Object.hasOwn(patch, 'livestreamRoomName')) {
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
  ipcMain.handle('monitor:set-active', (_event, active: boolean) => {
    return injectATEMState(monitor.setMonitoringActive(active));
  });
  ipcMain.handle('monitor:set-paused', async (_event, paused: boolean) => {
    return injectATEMState(monitor.setMonitoringActive(!paused));
  });
  ipcMain.handle('monitor:set-simulated-live', (_event, enabled: boolean) => {
    const monitorSnapshot = monitor.setSimulatedLive(enabled);
    atemMonitor.setLiveActive(monitorSnapshot.monitoringActive);
    const snapshot = injectATEMState(monitorSnapshot);
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
    const current = latestSnapshot ?? injectATEMState(monitor.getSnapshot());
    if (current.activePreAlertSource === 'atem_camera') {
      atemMonitor.dismissCameraPreAlert();
    } else {
      monitor.dismissPreAlert();
    }
    const snapshot = injectATEMState(monitor.getSnapshot());
    latestSnapshot = snapshot;
    broadcastSnapshot(snapshot);
    updateTray(snapshot);
    syncFloatingWindow(snapshot);
    return snapshot;
  });
  ipcMain.handle('monitor:prompt-response', (event, accept: boolean) => {
    if (event.sender !== monitoringPromptWindow?.webContents) return;
    const valid = Date.now() < monitoringPromptDeadline && latestSnapshot?.connected && latestSnapshot.virtualCameraActive;
    monitoringPromptWindow?.close();
    if (accept === true && valid) monitor.setMonitoringActive(true);
  });
  ipcMain.handle('floating:resize', (event, phase: string, edge?: string) => {
    if (latestSnapshot?.config.floatingWindowLocked) { floatingDrag = null; return; }
    const target = floatingWindow;
    if (!target || target.isDestroyed() || event.sender !== target.webContents) return;
    if (phase === 'start' && edge && /^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) {
      floatingDrag = { bounds: target.getBounds(), cursor: screen.getCursorScreenPoint(), edge };
    } else if ((phase === 'move' || phase === 'end') && floatingDrag) {
      const { bounds, cursor, edge: direction } = floatingDrag;
      const point = screen.getCursorScreenPoint();
      const mode = latestSnapshot?.config.floatingWindowMode ?? 'audio';
      const ratio = floatingWindowAspectRatio(mode) ?? bounds.width / bounds.height;
      target.setBounds(resizeFloatingBounds(bounds,
        { x: point.x - cursor.x, y: point.y - cursor.y }, direction, ratio,
        target.getMinimumSize(), target.getMaximumSize()), false);
      applyFloatingWindowShape();
      if (phase === 'end') { floatingDrag = null; saveFloatingWindowBoundsFromWindow(); }
    }
  });
  ipcMain.handle('floating:set-visible', async (_event, visible: boolean) => setFloatingWindowVisible(visible));
  ipcMain.handle('settings:show', () => {
    showSettingsWindow();
  });
  ipcMain.handle('history:list', () => historyStore.list());
  ipcMain.handle('history:clear', async () => {
    const history = await historyStore.clear();
    monitor.setHistory(history);
    const snapshot = injectATEMState(monitor.getSnapshot());
    latestSnapshot = snapshot;
    broadcastSnapshot(snapshot);
    return history;
  });
  ipcMain.handle('alert:position-updated', async (_event, displayId: number, position: { x: number; y: number }) => {
    await saveAlertPosition(displayId, position);
  });
  ipcMain.handle('displays:get', () => getDisplays());
  ipcMain.handle('preflight:release-control', () => releasePreflightControl());
  ipcMain.handle('preflight:overlay-state', () => launchOverlay.state());
  ipcMain.handle('preflight:restore-target', (_event, target: unknown, settings: unknown) => {
    if (target !== 'obs_projector' && (!isPreflightAppId(target) || target === 'cosmic_cat')) throw new Error('未知窗口');
    return runPreflight(() => { launchOverlay.report('正在恢复并验证目标窗口位置', 50); return preflightCheckService.restoreTarget(target, preflightSettingsValue(settings)); }, true);
  });
  ipcMain.handle('preflight:check', (_event, settings: unknown) => {
    return preflightCheckService.check(preflightSettingsValue(settings).apps);
  });
  ipcMain.handle('preflight:launch-all', (event, settings: unknown) => {
    return preparationFlight.run(() => runPreflight(async () => {
    const resolvedSettings = preflightSettingsValue(settings);
    const report = (message: string, percent: number) => {
      preflightCheckService.assertActive();
      launchOverlay.report(message, percent);
      if (!event.sender.isDestroyed()) event.sender.send('preflight:progress', { message, percent });
    };
    if (PREFLIGHT_APP_IDS.some(id => resolvedSettings.apps[id].enabled && !resolvedSettings.apps[id].path.trim())) {
      report('正在自动查找尚未配置的软件路径', 0);
      try {
        const discovery = await preflightCheckService.discover();
        preflightCheckService.assertActive();
        const savedApps = { ...monitor.getSnapshot().config.preflightApps };
        let changed = false;
        for (const item of discovery.discovered) {
          if (!resolvedSettings.apps[item.id].enabled || resolvedSettings.apps[item.id].path.trim()) continue;
          resolvedSettings.apps[item.id] = { ...resolvedSettings.apps[item.id], path: item.path, pathSource: item.source };
          if (!savedApps[item.id].path.trim()) {
            savedApps[item.id] = { ...savedApps[item.id], path: item.path, pathSource: item.source };
            changed = true;
          }
        }
        if (changed) await monitor.updateConfig(await configStore.update({ preflightApps: savedApps }));
      } catch (error) {
        preflightCheckService.assertActive();
        console.error('[preflight] automatic discovery failed', error);
        // Missing targets receive their own actionable launch failures below.
      }
    }
    const result = await preflightCheckService.launchAll(resolvedSettings, report);
    report('正在准备 OBS 输出投影', 78);
    result.projector = !resolvedSettings.projector.enabled
      ? { state: 'disabled', message: '节目输出投影未启用', positionRestored: false }
      : result.failures.obs
      ? { state: 'failed', message: `OBS 启动失败：${result.failures.obs}`, positionRestored: false }
      : await executePreflightProjector(resolvedSettings, false, report);
    return result;
  }, true));
  });
  ipcMain.handle('preflight:launch', (_event, id: unknown, settings: unknown, retry = false) => {
    if (!isPreflightAppId(id)) throw new Error('未知的开播检查项目');
    return runPreflight(() => { launchOverlay.report('正在启动并恢复目标软件', 25); return preflightCheckService.launch(id, preflightSettingsValue(settings), retry === true); }, true);
  });
  ipcMain.handle('preflight:discover', () => {
    return preflightCheckService.discover();
  });
  ipcMain.handle('preflight:capture-layout', async (_event, settings: unknown, target: unknown) => runPreflight(async () => {
    if (target !== undefined && target !== 'obs_projector' && (!isPreflightAppId(target) || target === 'cosmic_cat')) throw new Error('未知窗口');
    const captured = await preflightCheckService.captureLayout(preflightSettingsValue(settings), target as import('../shared/types.js').PreflightPlacementTarget | undefined, confirmLayoutWindow);
    if (captured.captured.length > 0) {
      const current = monitor.getSnapshot().config;
      const placements = { ...current.preflightWindowPlacements };
      for (const target of captured.captured) placements[target] = captured.placements[target];
      const config = await configStore.update({
        preflightWindowPlacements: placements,
        ...(captured.captured.includes('obs_projector') ? { preflightProjector: { ...current.preflightProjector, enabled: true, restoreWindowPosition: true } } : {})
      });
      await monitor.updateConfig(config);
      captured.placements = config.preflightWindowPlacements;
    }
    return captured;
  }));
  ipcMain.handle('preflight:open-projector', (_event, settings: unknown) => {
    return runPreflight(() => executePreflightProjector(preflightSettingsValue(settings), true, (message, percent) => launchOverlay.report(message, percent)), true);
  });
  ipcMain.handle('preflight:pick-target', async (_event, id: unknown) => {
    if (!isPreflightAppId(id)) throw new Error('未知的开播检查项目');
    const labels = {
      obs: 'OBS',
      douyin: '平台直播工具',
      browser: '浏览器',
      software_control: 'Software Control',
      cosmic_cat: '宇宙猫检测'
    } as const;
    const options: Electron.OpenDialogOptions = {
      title: `选择 ${labels[id]} 的快捷方式或程序`,
      buttonLabel: '使用此程序',
      properties: ['openFile'],
      filters: process.platform === 'win32'
        ? [{ name: '程序或快捷方式', extensions: ['exe', 'lnk', 'bat', 'cmd', 'com'] }, { name: '所有文件', extensions: ['*'] }]
        : [{ name: '应用程序', extensions: ['app'] }, { name: '所有文件', extensions: ['*'] }]
    };
    const result = settingsWindow && !settingsWindow.isDestroyed()
      ? await dialog.showOpenDialog(settingsWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('atem:get-state', () => atemMonitor.getSnapshot());
  ipcMain.handle('atem:history-clear', async () => {
    atemSwitchHistory = await atemHistoryStore.clear();
    const merged = injectATEMState(latestSnapshot ?? monitor.getSnapshot());
    latestSnapshot = merged;
    broadcastSnapshot(merged);
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

function preflightConfigsValue(value: unknown): PreflightAppConfigs {
  const fallback = (latestSnapshot ?? monitor.getSnapshot()).config.preflightApps;
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<keyof PreflightAppConfigs, unknown>>
    : {};
  return Object.fromEntries(PREFLIGHT_APP_IDS.map((id) => {
    const item = raw[id] && typeof raw[id] === 'object' && !Array.isArray(raw[id])
      ? raw[id] as { enabled?: unknown; path?: unknown; restoreWindowPosition?: unknown; pathSource?: unknown; customLabel?: unknown; launchUrl?: unknown }
      : {};
    return [id, {
      enabled: typeof item.enabled === 'boolean' ? item.enabled : fallback[id].enabled,
      path: typeof item.path === 'string' ? item.path.trim().slice(0, 2048) : fallback[id].path,
      restoreWindowPosition: id === 'cosmic_cat'
        ? false
        : typeof item.restoreWindowPosition === 'boolean' ? item.restoreWindowPosition : fallback[id].restoreWindowPosition,
      pathSource: preflightPathSourceValue(item.pathSource, fallback[id].pathSource),
      customLabel: typeof item.customLabel === 'string' ? item.customLabel.trim().slice(0, 32) : fallback[id].customLabel,
      launchUrl: id === 'browser' && typeof item.launchUrl === 'string' ? item.launchUrl.trim().slice(0, 2048) : fallback[id].launchUrl
    }];
  })) as unknown as PreflightAppConfigs;
}

function preflightSettingsValue(value: unknown): PreflightSettings {
  const fallbackConfig = (latestSnapshot ?? monitor.getSnapshot()).config;
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { apps?: unknown; projector?: unknown; windowPlacements?: unknown }
    : {};
  const projectorRaw = raw.projector && typeof raw.projector === 'object' && !Array.isArray(raw.projector)
    ? raw.projector as { enabled?: unknown; restoreWindowPosition?: unknown }
    : {};
  return {
    apps: preflightConfigsValue(raw.apps),
    projector: {
      enabled: typeof projectorRaw.enabled === 'boolean' ? projectorRaw.enabled : fallbackConfig.preflightProjector.enabled,
      restoreWindowPosition: typeof projectorRaw.restoreWindowPosition === 'boolean'
        ? projectorRaw.restoreWindowPosition
        : fallbackConfig.preflightProjector.restoreWindowPosition
    },
    windowPlacements: preflightWindowPlacementsValue(raw.windowPlacements, fallbackConfig.preflightWindowPlacements)
  };
}

function preflightWindowPlacementsValue(value: unknown, fallback: PreflightWindowPlacements): PreflightWindowPlacements {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const result: PreflightWindowPlacements = {};
  for (const target of [...PREFLIGHT_APP_IDS, 'obs_projector'] as const) {
    if (target === 'cosmic_cat') continue;
    const placement = preflightWindowPlacementValue((value as Record<string, unknown>)[target]);
    if (placement) result[target] = placement;
  }
  return result;
}

function preflightWindowPlacementValue(value: unknown): PreflightWindowPlacement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const workArea = preflightRectValue(raw.capturedWorkArea, false);
  const normalized = preflightRectValue(raw.normalizedBounds, true);
  if (!workArea || !normalized) return null;
  return {
    ...(typeof raw.windowTitle === 'string' ? { windowTitle: raw.windowTitle.slice(0, 512) } : {}),
    displayId: Number.isInteger(raw.displayId) ? Number(raw.displayId) : null,
    displayLabel: typeof raw.displayLabel === 'string' ? raw.displayLabel.slice(0, 160) : '',
    capturedWorkArea: workArea,
    normalizedBounds: normalized,
    windowState: raw.windowState === 'maximized' ? 'maximized' : 'normal',
    capturedAt: Number.isFinite(raw.capturedAt) ? Math.max(0, Math.round(Number(raw.capturedAt))) : 0
  };
}

function preflightRectValue(value: unknown, normalized: boolean): PreflightWindowPlacement['capturedWorkArea'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const values = [raw.x, raw.y, raw.width, raw.height].map(Number);
  if (!values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) return null;
  const [x, y, width, height] = values;
  return normalized
    ? { x: clamp(x, -4, 4), y: clamp(y, -4, 4), width: clamp(width, .05, 4), height: clamp(height, .05, 4) }
    : { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function preflightPathSourceValue(value: unknown, fallback: PreflightPathSource): PreflightPathSource {
  return value === 'manual' || value === 'standard' || value === 'registry' || value === 'start_menu' || value === 'desktop'
    ? value
    : fallback;
}

async function executePreflightProjector(settings: PreflightSettings, force: boolean, report: (message: string, percent: number) => void = () => {}): Promise<PreflightProjectorResult> {
  if (!force && !settings.projector.enabled) {
    return { state: 'disabled', message: '节目输出投影未启用', positionRestored: false };
  }

  try {
    preflightCheckService.assertActive();
    if (!force && settings.projector.restoreWindowPosition && !settings.windowPlacements.obs_projector) {
      throw new Error('尚未保存投影位置，请点击“打开或重试投影”，摆好窗口后保存布局');
    }
    const restoreExistingProjector = async () => {
      const inspection = await preflightCheckService.inspectOBSWindows(settings.apps);
      if (!inspection.projector) return { result: null, handles: inspection.handles };
      const placement = settings.projector.restoreWindowPosition ? settings.windowPlacements.obs_projector : undefined;
      if (placement) {
        await preflightCheckService.restoreWindow(inspection.projector, placement);

        return {
          result: { state: 'already_open', message: '节目输出投影已打开并恢复到固定位置', positionRestored: true } as PreflightProjectorResult,
          handles: inspection.handles
        };
      }
      return {
        result: {
          state: 'already_open',
          message: '节目输出投影已打开；可在“固定窗口位置”中勾选投影并保存当前布局',
          positionRestored: false
        } as PreflightProjectorResult,
        handles: inspection.handles
      };
    };

    if (process.platform === 'win32' && !monitor.getSnapshot().connected) {
      const beforeConnection = await restoreExistingProjector();
      if (beforeConnection.result) return beforeConnection.result;
    }

    if (force && !monitor.getSnapshot().connected) {
      const launch = await preflightCheckService.launch('obs', settings);
      if (launch.failures.obs) throw new Error(`OBS 启动失败：${launch.failures.obs}`);
    }
    if (!monitor.getSnapshot().connected) void monitor.reconnect().catch((error) => console.error('[preflight] reconnect failed', error));
    report('正在等待 OBS WebSocket 连接', 82);
    const connected = await waitForOBSConnection(60_000);
    if (!connected) throw new Error('等待 OBS WebSocket 连接超时，请检查端口和密码');
    let existingHandles = new Set<string>();
    if (process.platform === 'win32') {
      const inspection = await restoreExistingProjector();
      if (inspection.result) return inspection.result;
      existingHandles = inspection.handles;
    }
    report('正在打开 OBS 投影－输出', 88);
    preflightCheckService.assertActive();
    await monitor.openProgramProjector();

    let positionRestored = false;
    if (process.platform === 'win32') {
      const projector = await preflightCheckService.waitForNewOBSProjector(settings.apps, existingHandles, 30_000);
      if (!projector) {
        throw new Error('OBS 已接受投影请求，但 30 秒内未找到投影窗口。如果 OBS 正显示“缺失文件”或其他弹窗，请先处理后再点击重试');
      }
      const placement = settings.projector.restoreWindowPosition ? settings.windowPlacements.obs_projector : undefined;
      if (placement) {
        report('正在恢复投影窗口的位置与大小', 94);
        await preflightCheckService.restoreWindow(projector, placement);

        positionRestored = true;
      }
    }

    return {
      state: 'opened',
      message: positionRestored ? '节目输出投影已打开并恢复位置' : '节目输出投影已打开',
      positionRestored
    };
  } catch (error) {
    console.error('[preflight projector]', error);
    return { state: 'failed', message: preflightError(error, '打开节目输出投影失败，请检查 OBS 连接后重试'), positionRestored: false };
  }
}

async function waitForOBSConnection(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    preflightCheckService.assertActive();
    if (monitor.getSnapshot().connected) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return monitor.getSnapshot().connected;
}

// Merge ATEM state into an AppSnapshot
function injectATEMState(snapshot: AppSnapshot): AppSnapshot {
  const atem = atemMonitor?.getSnapshot();
  const customizations = snapshot.config.atemInputCustomizations;
  const hardwareLabels = atem?.inputLabels ?? snapshot.atemInputHardwareLabels ?? {};
  const effectiveLabels = Object.fromEntries(Object.entries(hardwareLabels).map(([inputId, label]) => [
    Number(inputId),
    customizations[inputId]?.name || label
  ]));
  const muted = Date.now() < alertsMutedUntil;
  const audioAlertVisible = !muted && snapshot.activeAlertSource === 'audio';
  const cameraAlertVisible = Boolean(
    !muted && snapshot.config.atemCameraTimeAlertEnabled
    && snapshot.config.atemCameraFullscreenAlertEnabled
    && atem?.cameraFullscreenAlertVisible
  );
  const audioPreAlertVisible = !muted && snapshot.preAlertVisible && snapshot.activePreAlertSource !== 'atem_camera';
  const cameraPreAlertVisible = Boolean(
    !muted && snapshot.config.preAlertEnabled
    && snapshot.config.atemCameraTimeAlertEnabled
    && atem?.cameraPreAlertVisible
  );
  return {
    ...snapshot,
    alertsMutedUntil: muted ? alertsMutedUntil : 0,
    alertVisible: audioAlertVisible || cameraAlertVisible,
    activeAlertSource: audioAlertVisible ? 'audio' : cameraAlertVisible ? 'atem_camera' : null,
    preAlertVisible: audioPreAlertVisible || cameraPreAlertVisible,
    activePreAlertSource: audioPreAlertVisible ? 'audio' : cameraPreAlertVisible ? 'atem_camera' : null,
    preAlertRemainingSeconds: audioPreAlertVisible
      ? snapshot.preAlertRemainingSeconds
      : cameraPreAlertVisible
        ? atem?.cameraPreAlertRemainingSeconds ?? null
        : null,
    ...(atem ? {
      atemConnected: atem.connected,
      atemConnectionState: atem.connectionState,
      atemModelName: atem.modelName,
      atemProgramInput: atem.programInput,
      atemPreviewInput: atem.previewInput,
      atemInputIds: atem.inputIds,
      atemInputLabels: effectiveLabels,
      atemInputHardwareLabels: hardwareLabels,
      atemInputCount: atem.inputCount,
      atemProgramInputStartedAt: atem.programInputStartedAt,
      atemProgramInputElapsedSeconds: atem.programInputElapsedSeconds,
      atemProgramInputOverLimit: snapshot.config.atemCameraTimeAlertEnabled && atem.programInputOverLimit,
      atemProgramInputExempt: atem.programInputExempt,
      atemCameraPreAlertVisible: cameraPreAlertVisible,
      atemCameraAlertVisible: atem.cameraAlertVisible,
      atemSwitchHistory: atemSwitchHistory.map((entry) => ({
        ...entry,
        fromInputLabel: customizations[String(entry.fromInputId)]?.name || entry.fromInputLabel,
        toInputLabel: customizations[String(entry.toInputId)]?.name || entry.toInputLabel
      })),
      atemReconnectAttempt: atem.reconnectAttempt,
      atemNextReconnectAt: atem.nextReconnectAt,
      atemCurrentSession: decorateATEMSession(atemCurrentSession, snapshot.config, atem),
      atemRecentSessions: atemRecentSessions.map((session) => decorateATEMSession(session, snapshot.config, null) as ATEMLiveSession)
    } : {}),
  };
}

function syncATEMLiveSession(snapshot: AppSnapshot): void {
  const live = snapshot.monitoringActive;
  if (atemSessionTransitionPending || (live && atemCurrentSession) || (!live && !atemCurrentSession)) return;
  atemSessionTransitionPending = true;
  atemSessionQueue = atemSessionQueue.catch(() => undefined).then(async () => {
    if (live && !atemCurrentSession) {
      const state = await atemSessionStore.start(Date.now());
      atemCurrentSession = state.activeSession;
      atemRecentSessions = state.sessions;
    } else if (!live && atemCurrentSession) {
      const stop = pendingATEMSessionStop;
      const endedAt = stop?.endedAt ?? Date.now();
      const finalSegment = stop ? currentATEMSessionSegment(stop.state, atemCurrentSession, endedAt) : null;
      const state = await atemSessionStore.finish(endedAt, finalSegment);
      pendingATEMSessionStop = null;
      atemCurrentSession = state.activeSession;
      atemRecentSessions = state.sessions;
    } else {
      return;
    }
    if (!latestSnapshot) return;
    latestSnapshot = injectATEMState(latestSnapshot);
    broadcastSnapshot(latestSnapshot);
  }).catch((error) => {
    console.error(`[atem-session] failed to update live session: ${error instanceof Error ? error.message : String(error)}`);
  }).finally(() => {
    atemSessionTransitionPending = false;
    if (latestSnapshot) syncATEMLiveSession(latestSnapshot);
  });
}

function sessionSegmentFromSwitch(entry: ATEMSwitchHistoryEntry): ATEMSessionSegment {
  return {
    id: `segment-${entry.id}`,
    inputId: entry.fromInputId,
    inputLabel: entry.fromInputLabel,
    startedAt: entry.startedAt,
    endedAt: entry.switchedAt,
    durationSeconds: entry.durationSeconds
  };
}

function currentATEMSessionSegment(
  atem: ReturnType<ATEMMonitor['getSnapshot']>,
  session: ATEMLiveSession,
  endedAt = Date.now()
): ATEMSessionSegment | null {
  if (atem.programInput <= 0 || !atem.programInputStartedAt) return null;
  const startedAt = Math.max(session.startedAt, atem.programInputStartedAt);
  return {
    id: `segment-current-${session.id}-${atem.programInput}-${startedAt}`,
    inputId: atem.programInput,
    inputLabel: atem.inputLabels[atem.programInput] || `Input ${atem.programInput}`,
    startedAt,
    endedAt,
    durationSeconds: Math.max(0, Math.floor((endedAt - startedAt) / 1000))
  };
}

function decorateATEMSession(
  session: ATEMLiveSession | null,
  config: AppConfig,
  atem: ReturnType<ATEMMonitor['getSnapshot']> | null
): ATEMLiveSession | null {
  if (!session) return null;
  const segments = [...session.segments];
  const current = atem && session.endedAt === null ? currentATEMSessionSegment(atem, session) : null;
  if (current && current.durationSeconds > 0) segments.push(current);
  const totals = new Map<number, { inputLabel: string; durationSeconds: number }>();
  for (const segment of segments) {
    const item = totals.get(segment.inputId) ?? { inputLabel: segment.inputLabel, durationSeconds: 0 };
    item.durationSeconds += segment.durationSeconds;
    totals.set(segment.inputId, item);
  }
  const totalDurationSeconds = Array.from(totals.values()).reduce((sum, item) => sum + item.durationSeconds, 0);
  const usage = Array.from(totals.entries()).map(([inputId, item]) => {
    const custom = config.atemInputCustomizations[String(inputId)];
    return {
      inputId,
      inputLabel: custom?.name || item.inputLabel,
      color: custom?.color || defaultATEMInputColor(inputId),
      group: custom?.group || '未分组',
      durationSeconds: item.durationSeconds,
      percent: totalDurationSeconds > 0 ? (item.durationSeconds / totalDurationSeconds) * 100 : 0
    };
  }).sort((a, b) => b.durationSeconds - a.durationSeconds);
  return { ...session, segments, usage, totalDurationSeconds };
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
        void (async () => {
          if (snapshot.config.atemHardCutConfirm) {
            const target = snapshot.atemInputLabels[snapshot.atemPreviewInput] || `PGM ${snapshot.atemPreviewInput}`;
            const result = await dialog.showMessageBox({
              type: 'warning',
              buttons: ['取消', '确认切换'],
              defaultId: 0,
              cancelId: 0,
              title: '确认全局切台',
              message: `确认将 ${target} 从 PVW 切换到 PGM 吗？`,
              detail: '这是全局快捷键触发的直播画面切换。'
            });
            if (result.response !== 1) return;
          }
          await atem.autoTransition();
        })().catch((error) => {
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

function createSettingsWindow(initialPage?: 'preflight'): void {
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
  loadRendererSafely(settingsWindow, initialPage === 'preflight' ? '#settings?page=preflight' : '#settings', 'settings');

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

function showMonitoringPrompt(): void {
  monitoringPromptWindow?.close();
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(380, area.width);
  const height = Math.min(156, area.height);
  const target = new BrowserWindow({
    x: area.x + area.width - width - Math.min(16, area.width - width),
    y: area.y + area.height - height - Math.min(16, area.height - height),
    width, height, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  monitoringPromptWindow = target;
  let timer: NodeJS.Timeout | undefined;
  attachWindowDiagnostics(target, 'monitor-prompt');
  target.once('ready-to-show', () => {
    if (!latestSnapshot?.virtualCameraActive || latestSnapshot.monitoringActive) { target.close(); return; }
    monitoringPromptDeadline = Date.now() + 5000;
    target.showInactive();
    timer = setTimeout(() => { if (!target.isDestroyed()) target.close(); }, 5000);
  });
  target.once('closed', () => {
    clearTimeout(timer);
    if (monitoringPromptWindow === target) { monitoringPromptWindow = null; monitoringPromptDeadline = 0; }
  });
  loadRendererSafely(target, '#monitor-prompt', 'monitor-prompt');
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
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  floatingWindow.setOpacity(snapshot.config.floatingWindowOpacity);
  floatingWindow.setMovable(!snapshot.config.floatingWindowLocked);
  attachWindowDiagnostics(floatingWindow, 'floating');
  reinforceFloatingWindowTopmost();
  if (fixedAspectRatio) {
    floatingWindow.setAspectRatio(fixedAspectRatio);
  }
  applyFloatingWindowShape();
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatingWindow.once('ready-to-show', () => {
    applyFloatingWindowShape();
    floatingWindow?.showInactive();
    reinforceFloatingWindowTopmost(true);
    startFloatingWindowTopmostGuard();
  });
  floatingWindow.on('show', () => reinforceFloatingWindowTopmost(true));
  floatingWindow.on('blur', () => {
    setTimeout(() => reinforceFloatingWindowTopmost(true), 80).unref?.();
  });
  floatingWindow.on('moved', () => {
    saveFloatingWindowBoundsFromWindow();
  });
  floatingWindow.on('resize', () => {
    scheduleFloatingWindowShape();
    scheduleFloatingWindowResizeSettled();
  });
  const showFloatingMenu = () => {
    const config = monitor.getSnapshot().config;
    const update = (patch: Partial<AppConfig>) => { void configStore.update(patch).then(value => monitor.updateConfig(value)).catch(error => console.error('[floating menu]', error)); };
    Menu.buildFromTemplate([
      { label: '锁定浮窗', type: 'checkbox', checked: config.floatingWindowLocked, click: () => update({ floatingWindowLocked: !config.floatingWindowLocked }) },
      { label: '透明度', submenu: [100, 85, 70, 50, 30].map(value => ({ label: `${value}%`, type: 'radio' as const, checked: Math.round(config.floatingWindowOpacity * 100) === value, click: () => update({ floatingWindowOpacity: value / 100 }) })) },
      { label: '临时静音提醒（检测继续）', submenu: [1, 5, 15].map(value => ({ label: `${value} 分钟`, click: () => setTemporaryMute(value) })) },
      { label: '立即恢复提醒', enabled: alertsMutedUntil > Date.now(), click: () => setTemporaryMute(0) },
      { type: 'separator' },
      { label: '回到主界面', click: showSettingsWindow }
    ]).popup({ window: floatingWindow! });
  };
  floatingWindow.webContents.on('context-menu', showFloatingMenu);
  floatingWindow.on('system-context-menu', event => { event.preventDefault(); showFloatingMenu(); });
  floatingWindow.on('closed', () => {
    stopFloatingWindowTimers();
    floatingDrag = null;
    floatingWindow = null;
  });

  loadRendererSafely(floatingWindow, '#floating', 'floating');
}

function closeFloatingWindow(mode: 'close' | 'destroy' = 'destroy'): void {
  if (!floatingWindow) {
    return;
  }

  stopFloatingWindowTimers();
  safelyCloseWindow(floatingWindow, mode);
  floatingWindow = null;
}

function syncFloatingWindow(snapshot: AppSnapshot): void {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.setOpacity(snapshot.config.floatingWindowOpacity);
    floatingWindow.setMovable(!snapshot.config.floatingWindowLocked);
    if (snapshot.config.floatingWindowLocked) floatingDrag = null;
  }
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
  projectorSafetyOverlay.configure(nextConfig.projectorSafety);
  const nextSnapshot = await monitor.updateConfig(nextConfig);
  latestSnapshot = injectATEMState(nextSnapshot);
  await atemMonitor.setConfig(
    nextConfig.atemEnabled,
    nextConfig.atemHost,
    nextConfig.atemCameraTimeLimitSeconds,
    nextConfig.atemCameraTimeAlertEnabled,
    nextConfig.atemPrimaryInputIds
  );
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

function syncAlertSurfaces(previous: AppSnapshot | null, current: AppSnapshot): void {
  if (!current.alertVisible) {
    closeAlertWindows('destroy');
    closeAlertBackdropWindows('destroy');
    closeToastAlertWindows('destroy');
    return;
  }

  closePreAlertWindows('destroy');
  if (!previous?.alertVisible || previous.activeAlertSource !== current.activeAlertSource) {
    showAlertSurfaces(current);
  }
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
      hasShadow: false,
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
        sandbox: true,
        backgroundThrottling: false
      }
    });

    attachWindowDiagnostics(preAlertWindow, `prealert:${display.id}`);
    preAlertWindow.setAlwaysOnTop(true, 'floating');
    preAlertWindow.once('ready-to-show', () => {
      applyRoundedWindowShape(preAlertWindow, 18);
      preAlertWindow.showInactive();
    });
    preAlertWindow.on('closed', () => {
      preAlertWindows.delete(display.id);
    });

    preAlertWindows.set(display.id, preAlertWindow);
    loadRendererSafely(preAlertWindow, '#prealert', `prealert:${display.id}`);
  }
}

function syncPreAlertSurfaces(snapshot: AppSnapshot): void {
  if (snapshot.preAlertVisible && !snapshot.alertVisible) {
    showPreAlertWindows(snapshot);
  } else {
    closePreAlertWindows('destroy');
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
  const alertSource = before.activeAlertSource;
  const shouldRecord = alertSource === 'audio' && before.alertVisible && !monitor.isTestAlertActive() && isHistoryAction(action);

  try {
    closeAlertWindows('destroy');
    closeAlertBackdropWindows('destroy');
    closeToastAlertWindows('destroy');
    closePreAlertWindows('destroy');
    if (alertSource === 'atem_camera') {
      atemMonitor.handleCameraAlertAction(action);
    } else {
      monitor.handleAlertAction(action);
    }

    let monitorSnapshot = monitor.getSnapshot();
    if (action === 'pause') {
      monitorSnapshot = monitor.setMonitoringActive(false);
      atemMonitor.setLiveActive(false);
    }

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

    const previousSnapshot = before;
    latestSnapshot = injectATEMState(monitorSnapshot);
    broadcastSnapshot(latestSnapshot);
    updateTray(latestSnapshot);
    syncFloatingWindow(latestSnapshot);
    syncAlertSurfaces(previousSnapshot, latestSnapshot);
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
    snapshot.monitoringActive,
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
        label: snapshot.config.floatingWindowEnabled ? '关闭小浮窗' : '打开小浮窗',
        click: () => {
          void setFloatingWindowVisible(!snapshot.config.floatingWindowEnabled);
        }
      },
      {
        label: snapshot.monitoringActive ? '暂停检测' : '恢复检测',
        click: () => {
          monitor.setMonitoringActive(!snapshot.monitoringActive);
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
      reportRuntimeError('renderer_load_rejected', label, error);
    }
  });
}

function broadcastSnapshot(snapshot: AppSnapshot): void {
  const fullSnapshot = rendererSnapshot(snapshot, true);
  const compactSnapshot = rendererSnapshot(snapshot, false);
  BrowserWindow.getAllWindows().forEach((window) => {
    sendToWindow(window, 'snapshot', window === settingsWindow ? fullSnapshot : compactSnapshot);
  });
}

function broadcastMeterFrame(frame: AudioMeterFrame): void {
  for (const window of [settingsWindow, floatingWindow]) {
    if (window) sendToWindow(window, 'meter:update', frame);
  }
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
  window.on('show', () => sendToWindow(window, 'window:shown', null));
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
    reportRuntimeError(`renderer_load_${errorCode}`, label, `${errorDescription}: ${validatedUrl}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererUnavailable.add(window);
    console.error(`[${label}] renderer gone: ${details.reason}`);
    reportRuntimeError(`renderer_gone_${details.reason}`, label, `${details.reason} (exit ${details.exitCode})`);
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

function reportRuntimeError(code: string, source: string, error: unknown): void {
  const summary = runtimeDiagnostics.record(code, source, error);
}

function handleFatalMainError(error: unknown, code: string): void {
  if (handlingFatalMainError) {
    app.exit(1);
    return;
  }
  handlingFatalMainError = true;
  isQuitting = true;
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[app] fatal main-process error: ${message}`);
  reportRuntimeError(code, 'main', error);
  const relaunchArgs = crashRestartArgs(process.argv.slice(1));
  if (relaunchArgs) app.relaunch({ args: relaunchArgs });
  const forceExit = setTimeout(() => app.exit(1), 1500);
  void mainLogger.flush().finally(() => {
    clearTimeout(forceExit);
    app.exit(1);
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
  if (mode === 'audio_atem') return FLOATING_AUDIO_ATEM_MIN_WIDTH;
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
  reinforceFloatingWindowTopmost();
  applyFloatingWindowShape();
}

function reinforceFloatingWindowTopmost(moveToFront = false): void {
  if (preflightBusy) return;
  if (!floatingWindow || floatingWindow.isDestroyed()) return;

  try {
    floatingWindow.setAlwaysOnTop(true, process.platform === 'win32' ? 'screen-saver' : 'floating');
    floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (moveToFront && floatingWindow.isVisible()) floatingWindow.moveTop();
  } catch {
    // The native window may already be closing while a deferred guard runs.
  }
}

function startFloatingWindowTopmostGuard(): void {
  if (floatingTopmostTimer) clearInterval(floatingTopmostTimer);
  if (process.platform !== 'win32') return;
  floatingTopmostTimer = setInterval(() => reinforceFloatingWindowTopmost(), 2500);
  floatingTopmostTimer.unref?.();
}

function scheduleFloatingWindowShape(): void {
  if (process.platform !== 'win32' || floatingShapeTimer) return;
  floatingShapeTimer = setTimeout(() => {
    floatingShapeTimer = null;
    applyFloatingWindowShape();
  }, 48);
  floatingShapeTimer.unref?.();
}

function scheduleFloatingWindowResizeSettled(): void {
  if (floatingResizeSettleTimer) clearTimeout(floatingResizeSettleTimer);
  floatingResizeSettleTimer = setTimeout(() => {
    floatingResizeSettleTimer = null;
    if (floatingDrag) return;
    keepFloatingWindowAspectRatio();
    applyFloatingWindowShape();
    saveFloatingWindowBoundsFromWindow();
    reinforceFloatingWindowTopmost();
  }, 120);
  floatingResizeSettleTimer.unref?.();
}

function stopFloatingWindowTimers(): void {
  if (floatingTopmostTimer) clearInterval(floatingTopmostTimer);
  if (floatingResizeSettleTimer) clearTimeout(floatingResizeSettleTimer);
  if (floatingShapeTimer) clearTimeout(floatingShapeTimer);
  floatingTopmostTimer = null;
  floatingResizeSettleTimer = null;
  floatingShapeTimer = null;
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
  const width = clamp(bounds.width, floatingWindowMinWidthForMode(mode), FLOATING_WINDOW_MAX_WIDTH);
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

  const { width, height } = floatingWindow.getBounds();
  const mode = latestSnapshot?.config.floatingWindowMode ?? 'audio';
  const baseWidth = mode === 'audio_atem'
    ? FLOATING_AUDIO_ATEM_DEFAULT_WIDTH
    : mode === 'multifunction'
      ? FLOATING_MULTI_DEFAULT_WIDTH
      : FLOATING_WINDOW_DEFAULT_WIDTH;
  const radius = Math.min(Math.round(FLOATING_WINDOW_BASE_RADIUS * (width / baseWidth)), Math.floor(width / 2), Math.floor(height / 2));
  applyRoundedWindowShape(floatingWindow, radius);
}

function applyRoundedWindowShape(targetWindow: BrowserWindow, radius: number): void {
  if (process.platform !== 'win32' || targetWindow.isDestroyed()) return;

  const windowWithShape = targetWindow as BrowserWindow & {
    setShape?: (rectangles: WindowShapeRectangle[]) => void;
  };
  if (typeof windowWithShape.setShape !== 'function') {
    return;
  }

  const { width, height } = targetWindow.getBounds();
  windowWithShape.setShape(roundedWindowShape(width, height, radius));
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
    paused: '已暂停',
    error: '异常'
  };

  return labels[status] ?? status;
}

function isHistoryAction(action: AlertAction): boolean {
  return action === 'acknowledge' || action === 'pause';
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
