import { preflightError } from '../shared/preflightErrors.js';
import { screen, shell, type ShortcutDetails } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { discoverPreflightApps } from './preflightDiscovery.js';
import { WindowsWindowManager, selectMainWindow, selectNewOBSProjectorWindow, selectOBSProjectorWindow, type WindowsTopLevelWindow } from './windowsWindowManager.js';
import { browserNewWindowArgument, findPreflightProcess, findPreflightProcesses, parsePosixProcessList, parseWindowsProcessJson, parseWindowsTaskList, type ProcessEntry } from '../shared/preflight.js';
import { captureWindowPlacement, resolveWindowPlacement, type PlacementDisplay } from '../shared/windowPlacement.js';
import {
  PREFLIGHT_APP_IDS,
  type PreflightAppConfigs,
  type PreflightAppId,
  type PreflightAppStatus,
  type PreflightCheckResult,
  type PreflightDiscoveryResult,
  type PreflightLayoutCaptureResult,
  type PreflightLaunchResult,
  type PreflightPlacementTarget,
  type PreflightSettings,
  type PreflightWindowPlacement
} from '../shared/types.js';

const execFileAsync = promisify(execFile);
const PROCESS_LIST_CACHE_MS = 1_500;

let processListCache: { expiresAt: number; promise: Promise<ProcessEntry[]> } | null = null;

export class PreflightCheckService {
  private readonly windows = new WindowsWindowManager();
  private cancelled = false;
  private openedBrowserPages = new Set<string>();
  begin(): void { this.cancelled = false; this.windows.reset(); }
  cancel(): void { this.cancelled = true; this.windows.cancel(); }
  assertActive(): void { if (this.cancelled) throw new Error('已取消自动操作'); }
  async restoreTarget(id: PreflightPlacementTarget, settings: PreflightSettings): Promise<void> {
    this.assertActive();
    const placement = settings.windowPlacements[id];
    if (!placement) throw new Error('尚未保存位置，请先保存此窗口');
    if (process.platform !== 'win32') throw new Error('窗口布局恢复仅支持 Windows');
    if (id === 'obs_projector') {
      const window = await this.findOBSProjector(settings.apps);
      if (!window) throw new Error('未找到输出投影，请先打开投影');
      await this.restoreWindow(window, placement);
    } else await this.waitAndRestoreApp(id, settings.apps, placement);
  }
  private knownOBSProjectorHandle: string | null = null;

  async check(configs: PreflightAppConfigs, forceRefresh = false): Promise<PreflightCheckResult> {
    const platform = platformLabel();
    let processes: ProcessEntry[];
    try {
      processes = await readProcessList(forceRefresh);
    } catch (error) {
      const message = errorMessage(error, '无法读取系统进程');
      return {
        platform,
        checkedAt: Date.now(),
        apps: PREFLIGHT_APP_IDS.map((id) => status(id, configs[id].path, 'error', message))
      };
    }

    const apps = await Promise.all(PREFLIGHT_APP_IDS.map(async (id): Promise<PreflightAppStatus> => {
      const configuredPath = configs[id].path.trim();
      const resolvedPath = shortcutDetails(configuredPath)?.target ?? '';
      const running = findPreflightProcess(id, processes, configuredPath, resolvedPath, configs[id].customLabel);
      if (running) {
        return {
          ...status(id, configuredPath, 'running', '已检测到正在运行'),
          pid: running.pid,
          detectedProcessName: running.name
        };
      }

      if (id === 'cosmic_cat' && process.platform !== 'win32') {
        return status(id, configuredPath, 'unsupported', '管理员启动仅支持 Windows');
      }
      if (!configuredPath) {
        return status(id, configuredPath, 'not_configured', '尚未设置快捷方式');
      }
      if (!existsSync(configuredPath)) {
        return status(id, configuredPath, 'error', '快捷方式或程序路径已失效');
      }
      return status(id, configuredPath, 'not_running', '已配置，当前未运行');
    }));

    return { platform, checkedAt: Date.now(), apps };
  }

  discover(): Promise<PreflightDiscoveryResult> {
    return discoverPreflightApps();
  }

  async captureLayout(settings: PreflightSettings, target?: PreflightPlacementTarget, confirm?: (label: string, suggested: WindowsTopLevelWindow | null, candidates: WindowsTopLevelWindow[]) => Promise<WindowsTopLevelWindow | null>): Promise<PreflightLayoutCaptureResult> {
    const capturedAt = Date.now();
    const failures: Partial<Record<PreflightPlacementTarget, string>> = {};
    if (process.platform !== 'win32') {
      return {
        platform: platformLabel(),
        placements: settings.windowPlacements,
        captured: [],
        failures: { obs: '固定窗口布局仅支持 Windows' },
        capturedAt
      };
    }

    const processes = await readProcessList(true);
    const displays = await this.placementDisplays();
    const choose = async (label: string, suggested: WindowsTopLevelWindow | null, candidates: WindowsTopLevelWindow[]) => {
      const selected = confirm ? await confirm(label, suggested, candidates) : suggested;
      this.assertActive();
      if (!selected) throw new Error(confirm ? '已跳过保存；原有位置保持不变' : '未找到可保存的窗口，请先打开该软件');
      if (!candidates.some(window => window.handle === selected.handle && window.pid === selected.pid)) throw new Error('所选窗口不属于此软件，请重新选择程序路径后保存');
      const current = (await this.windows.listWindows([selected.pid])).find(w => w.handle === selected.handle);
      if (!current) throw new Error('确认的窗口已关闭，请重新打开后保存');
      return current;
    };
    const placements = { ...settings.windowPlacements };
    const captured: PreflightPlacementTarget[] = [];

    for (const id of PREFLIGHT_APP_IDS) {
      this.assertActive();
      if (id === 'cosmic_cat' || (target && target !== id)) continue;
      if (!settings.apps[id].enabled || !settings.apps[id].restoreWindowPosition) continue;
      try {
        const windows = await this.windowsForApp(id, settings.apps, processes);
        const mainWindow = await choose(settings.apps[id].customLabel || id, selectMainWindow(windows, id === 'obs'), windows);
        if (!mainWindow) throw new Error('未找到可保存的主窗口，请先打开该软件');
        placements[id] = { ...captureWindowPlacement(mainWindow.bounds, mainWindow.windowState, displays, capturedAt), windowTitle: mainWindow.title };
        captured.push(id);
      } catch (error) {
        failures[id] = errorMessage(error, '保存窗口位置失败');
      }
    }

    this.assertActive();
    if ((!target || target === 'obs_projector') && settings.projector.restoreWindowPosition) {
      try {
        const projectorWindows = await this.windowsForApp('obs', settings.apps, processes);
        const projector = await choose('OBS 输出投影', await this.findOBSProjector(settings.apps, processes), projectorWindows);
        if (!projector) throw new Error('未找到已打开的节目输出投影');
        this.rememberOBSProjector(projector);
        placements.obs_projector = { ...captureWindowPlacement(projector.bounds, projector.windowState, displays, capturedAt), windowTitle: projector.title };
        captured.push('obs_projector');
      } catch (error) {
        failures.obs_projector = errorMessage(error, '保存投影位置失败');
      }
    }

    return { platform: 'windows', placements, captured, failures, capturedAt };
  }

  async launch(id: PreflightAppId, settings: PreflightSettings, retry = false): Promise<PreflightLaunchResult> {
    const before = await this.check(settings.apps, true);
    const current = before.apps.find((app) => app.id === id);
    const failures: Partial<Record<PreflightAppId, string>> = {};
    const launched: PreflightAppId[] = [];
    const restored: PreflightPlacementTarget[] = [];
    const restoreFailures: Partial<Record<PreflightPlacementTarget, string>> = {};

    const shouldOpenBrowserPage = !retry && id === 'browser' && Boolean(settings.apps.browser.launchUrl.trim());
    if (id === 'obs' && current?.state === 'running') {
      await this.resolveOBSStartupDialogs(settings.apps);
    }
    if (current?.state !== 'running' || shouldOpenBrowserPage) {
      try {
        const placement = id !== 'cosmic_cat' && settings.apps[id].restoreWindowPosition ? settings.windowPlacements[id] : undefined;
        const existingHandles = placement && id === 'browser'
          ? await this.appWindowHandles(id, settings.apps)
          : undefined;
        await this.launchConfiguredApp(id, settings.apps, placement);
        if (id === 'browser' && settings.apps.browser.launchUrl.trim()) this.openedBrowserPages.add(`${settings.apps.browser.path.trim()}|${settings.apps.browser.launchUrl.trim()}`);
        launched.push(id);
        if (placement) {
          try {
            await this.waitAndRestoreApp(id, settings.apps, placement, existingHandles);
            restored.push(id);
          } catch (error) {
            restoreFailures[id] = errorMessage(error, '窗口位置恢复失败');
          }
        }
      } catch (error) {
        failures[id] = errorMessage(error, '启动失败');
      }
    }

    if (current?.state === 'running' && !shouldOpenBrowserPage && id !== 'cosmic_cat' && settings.apps[id].restoreWindowPosition && settings.windowPlacements[id]) {
      try { await this.restoreTarget(id, settings); restored.push(id); }
      catch (error) { restoreFailures[id] = errorMessage(error, '窗口位置恢复失败'); }
    }
    if (id !== 'cosmic_cat' && settings.apps[id].restoreWindowPosition && !settings.windowPlacements[id]) {
      restoreFailures[id] = '已启用位置恢复但尚未保存布局，请摆好窗口后保存，或关闭此项位置恢复';
    }
    const after = await this.confirmStarted(settings.apps, launched, failures);
    return { ...after, launched, failures, restored, restoreFailures, projector: null };
  }

  async launchAll(settings: PreflightSettings, report: (message: string, percent: number) => void = () => {}): Promise<PreflightLaunchResult> {
    const before = await this.check(settings.apps, true);
    const failures: Partial<Record<PreflightAppId, string>> = {};
    const launched: PreflightAppId[] = [];
    const restored: PreflightPlacementTarget[] = [];
    const restoreFailures: Partial<Record<PreflightPlacementTarget, string>> = {};
    const existingWindowHandles: Partial<Record<PreflightAppId, Set<string>>> = {};
    let shouldResolveOBSStartupDialogs = false;
    const enabledCount = PREFLIGHT_APP_IDS.filter(id => settings.apps[id].enabled).length;
    let processed = 0;
    const names = { obs: 'OBS', douyin: '直播平台', browser: '浏览器', cosmic_cat: '宇宙猫', software_control: '软件控制'  };

    for (const id of PREFLIGHT_APP_IDS) {
      this.assertActive();
      if (!settings.apps[id].enabled) continue;
      const label = settings.apps[id].customLabel || names[id];
      report(`正在检查并启动 ${label}`, Math.round(processed++ / Math.max(1, enabledCount) * 60));
      const alreadyRunning = before.apps.find((app) => app.id === id)?.state === 'running';
      if (id === 'obs' && alreadyRunning) {
        shouldResolveOBSStartupDialogs = true;
      }
      if (id === 'browser' && !alreadyRunning) this.openedBrowserPages.clear();
      const browserPageKey = `${settings.apps.browser.path.trim()}|${settings.apps.browser.launchUrl.trim()}`;
      const shouldOpenBrowserPage = id === 'browser' && Boolean(settings.apps.browser.launchUrl.trim()) && !this.openedBrowserPages.has(browserPageKey);
      if (alreadyRunning && !shouldOpenBrowserPage) continue;
      try {
        const placement = id !== 'cosmic_cat' && settings.apps[id].restoreWindowPosition ? settings.windowPlacements[id] : undefined;
        if (placement && id === 'browser') {
          existingWindowHandles[id] = await this.appWindowHandles(id, settings.apps);
        }
        await this.launchConfiguredApp(id, settings.apps, placement, id !== 'obs');
        if (id === 'browser' && shouldOpenBrowserPage) this.openedBrowserPages.add(browserPageKey);
        launched.push(id);
        if (id === 'obs') shouldResolveOBSStartupDialogs = true;
      } catch (error) {
        failures[id] = errorMessage(error, '启动失败');
      }
    }

    if (shouldResolveOBSStartupDialogs) {
      report('正在等待 OBS 主窗口就绪', 62);
      try { await this.resolveOBSStartupDialogs(settings.apps); }
      catch (error) { failures.obs = errorMessage(error, 'OBS 主窗口未就绪'); }
    }

    report('正在恢复已保存的窗口布局', 70);
    const restoreTargets = PREFLIGHT_APP_IDS.filter((id) => settings.apps[id].enabled && !failures[id]
      && (launched.includes(id) || before.apps.some((app) => app.id === id && app.state === 'running')));
    await Promise.all(restoreTargets.map(async (id) => {
      const placement = id !== 'cosmic_cat' && settings.apps[id].restoreWindowPosition ? settings.windowPlacements[id] : undefined;
      if (!placement) {
        if (id !== 'cosmic_cat' && settings.apps[id].restoreWindowPosition) restoreFailures[id] = '已启用位置恢复但尚未保存布局，请摆好窗口后保存，或关闭此项位置恢复';
        return;
      }
      try {
        await this.waitAndRestoreApp(id, settings.apps, placement, existingWindowHandles[id]);
        restored.push(id);
      } catch (error) {
        restoreFailures[id] = errorMessage(error, '窗口位置恢复失败');
      }
    }));

    report('正在确认程序运行状态', 75);
    const after = await this.confirmStarted(settings.apps, launched, failures);
    return { ...after, launched, failures, restored, restoreFailures, projector: null };
  }

  private async confirmStarted(configs: PreflightAppConfigs, launched: PreflightAppId[], failures: Partial<Record<PreflightAppId, string>>): Promise<PreflightCheckResult> {
    const deadline = Date.now() + 15_000;
    let after: PreflightCheckResult;
    while (true) {
      this.assertActive();
      after = await this.check(configs, true);
      const pending = launched.filter(id => id !== 'cosmic_cat' && !failures[id] && after.apps.find(app => app.id === id)?.state !== 'running');
      if (!pending.length) return after;
      if (Date.now() >= deadline) {
        for (const id of pending) failures[id] = '启动请求已发送，但 15 秒内未检测到程序就绪，请检查软件弹窗后重试';
        return after;
      }
      await delay(600);
    }
  }

  async findOBSProjector(configs: PreflightAppConfigs, processes?: ProcessEntry[]): Promise<WindowsTopLevelWindow | null> {
    if (process.platform !== 'win32') return null;
    const processList = processes ?? await readProcessList();
    const windows = await this.windowsForApp('obs', configs, processList);
    return this.rememberOBSProjector(selectOBSProjectorWindow(windows, this.knownOBSProjectorHandle));
  }

  async inspectOBSWindows(configs: PreflightAppConfigs): Promise<{ projector: WindowsTopLevelWindow | null; handles: Set<string> }> {
    if (process.platform !== 'win32') return { projector: null, handles: new Set() };
    const windows = await this.windowsForApp('obs', configs, await readProcessList());
    return {
      projector: this.rememberOBSProjector(selectOBSProjectorWindow(windows, this.knownOBSProjectorHandle)),
      handles: new Set(windows.map((window) => window.handle))
    };
  }

  async waitForNewOBSProjector(configs: PreflightAppConfigs, existingHandles: Set<string>, timeoutMs = 15_000): Promise<WindowsTopLevelWindow | null> {
    if (process.platform !== 'win32') return null;
    let processes = await readProcessList();
    const resolvedPath = shortcutDetails(configs.obs.path)?.target ?? '';
    let pids = findPreflightProcesses('obs', processes, configs.obs.path, resolvedPath).map((process) => process.pid);
    if (pids.length === 0) {
      processes = await readProcessList(true);
      pids = findPreflightProcesses('obs', processes, configs.obs.path, resolvedPath).map((process) => process.pid);
    }
    const deadline = Date.now() + timeoutMs;
    const ignoredHandles = new Set(existingHandles);
    while (Date.now() < deadline) {
      this.assertActive();
      const windows = await this.windows.waitForNewWindows(pids, ignoredHandles, Math.max(250, deadline - Date.now()));
      const projector = selectNewOBSProjectorWindow(windows);
      if (projector) return this.rememberOBSProjector(projector);
      // A startup dialog or preview window may appear before the output projector.
      // Ignore only those handles and continue waiting within the same deadline.
      for (const window of windows) ignoredHandles.add(window.handle);
      if (windows.length === 0) break;
    }
    return null;
  }

  async listOBSWindowHandles(configs: PreflightAppConfigs): Promise<Set<string>> {
    if (process.platform !== 'win32') return new Set();
    const windows = await this.windowsForApp('obs', configs, await readProcessList());
    return new Set(windows.map((window) => window.handle));
  }

  async restoreWindow(
    window: WindowsTopLevelWindow,
    placement: PreflightWindowPlacement,
    stable = true
  ): Promise<void> {
    if (process.platform !== 'win32') return;
    this.assertActive();
    const resolved = resolveWindowPlacement(placement, await this.placementDisplays());
    this.assertActive();
    if (stable) {
      await this.windows.moveWindow(window.handle, resolved.bounds, resolved.windowState);
    } else {
      await this.windows.moveWindowOnce(window.handle, resolved.bounds, resolved.windowState);
    }
    this.assertActive();
    const actual = (await this.windows.listWindows([window.pid])).find(item => item.handle === window.handle);
    if (!actual) throw new Error('恢复后窗口已关闭，请重新打开后重试');
    const correct = resolved.windowState === 'maximized' ? actual.windowState === 'maximized'
      : actual.windowState === 'normal' && (['x', 'y', 'width', 'height'] as const).every(key => Math.abs(actual.bounds[key] - resolved.bounds[key]) <= 8);
    if (!correct) throw new Error('窗口未保持在目标位置，可能受软件最小尺寸或权限限制，请调整后重新保存');
  }

  private rememberOBSProjector(window: WindowsTopLevelWindow | null): WindowsTopLevelWindow | null {
    if (window) this.knownOBSProjectorHandle = window.handle;
    return window;
  }

  private async launchConfiguredApp(
    id: PreflightAppId,
    configs: PreflightAppConfigs,
    placement?: PreflightWindowPlacement,
    waitForOBSStartup = true
  ): Promise<void> {
    this.assertActive();
    const config = configs[id];
    const target = config.path.trim();
    if (id === 'cosmic_cat' && process.platform !== 'win32') throw new Error('宇宙猫检测的管理员启动仅支持 Windows');
    const launchUrl = id === 'browser' ? validatedLaunchUrl(config.launchUrl) : '';
    if (!target && launchUrl) {
      await shell.openExternal(launchUrl);
      return;
    }
    if (!target) throw new Error('请先设置快捷方式或程序路径');
    if (!existsSync(target)) throw new Error('快捷方式或程序路径已失效');

    const shortcut = shortcutDetails(target);
    if (process.platform === 'win32' && target.toLowerCase().endsWith('.lnk') && !shortcut && id !== 'cosmic_cat') {
      throw new Error('无法解析此快捷方式，请重新选择有效的 .lnk 文件');
    }
    const resolvedShortcutTarget = shortcut?.target ?? '';
    if (id === 'cosmic_cat') {
      // Launch the original shortcut through ShellExecute's runas verb. This
      // mirrors Windows Explorer's "Run as administrator" behavior and keeps
      // shortcut metadata intact. Cosmic Cat has no main window to restore.
      await this.windows.launchElevated(target);
      return;
    }

    if (process.platform === 'win32' && launchUrl) {
      await launchWindowsPathWithUrl(
        resolvedShortcutTarget || target,
        launchUrl,
        shortcut?.args ?? '',
        shortcut?.cwd ?? '',
        browserNewWindowArgument(resolvedShortcutTarget || target)
      );
      return;
    }
    if (process.platform === 'win32' && id === 'obs') {
      const executable = resolvedShortcutTarget || target;
      await launchWindowsPathWithArguments(
        executable,
        shortcut?.args ?? '',
        shortcut?.cwd || dirname(executable),
        ['--disable-missing-files-check']
      );
      if (waitForOBSStartup) await this.resolveOBSStartupDialogs(configs);
      return;
    }
    if (launchUrl) {
      await shell.openExternal(launchUrl);
      return;
    }
    const result = await shell.openPath(target);
    if (result) throw new Error(result);
  }

  private async waitAndRestoreApp(
    id: PreflightAppId,
    configs: PreflightAppConfigs,
    placement: PreflightWindowPlacement,
    excludedHandles?: Set<string>
  ): Promise<void> {
    if (process.platform !== 'win32') throw new Error('窗口布局恢复仅支持 Windows');
    const deadline = Date.now() + 15_000;
    let lastRestoreError: unknown;
    let restoreAttempts = 0;
    while (Date.now() < deadline) {
      this.assertActive();
      const windows = await this.windowsForApp(id, configs, await readProcessList());
      const eligible = excludedHandles ? windows.filter(window => !excludedHandles.has(window.handle)) : windows;
      const mainWindow = eligible.find(window => placement.windowTitle && window.title === placement.windowTitle) ?? selectMainWindow(eligible, id === 'obs');
      if (mainWindow) {
        try {
          await this.restoreWindow(mainWindow, placement);
          return;
        } catch (error) {
          this.assertActive();
          lastRestoreError = error;
          if (++restoreAttempts >= 3) throw error;
          // Re-enumerate: some apps replace their startup window with the main window.
        }
      }
      await delay(250);
    }
    if (lastRestoreError) throw lastRestoreError;
    throw new Error('软件已启动，但未在 15 秒内出现可恢复的主窗口');
  }

  private async windowsForApp(id: PreflightAppId, configs: PreflightAppConfigs, processes: ProcessEntry[]): Promise<WindowsTopLevelWindow[]> {
    const resolvedPath = shortcutDetails(configs[id].path)?.target ?? '';
    const matches = findPreflightProcesses(id, processes, configs[id].path, resolvedPath, configs[id].customLabel);
    return this.windows.listWindows(matches.map((process) => process.pid));
  }

  private async resolveOBSStartupDialogs(configs: PreflightAppConfigs): Promise<void> {
    if (process.platform !== 'win32') return;
    const deadline = Date.now() + 12_000;
    let pids: number[] = [];
    let lastProcessRefreshAt = 0;
    while (Date.now() < deadline) {
      this.assertActive();
      const now = Date.now();
      if (pids.length === 0 || now - lastProcessRefreshAt >= 1_500) {
        const processes = await readProcessList(true);
        const resolvedPath = shortcutDetails(configs.obs.path)?.target ?? '';
        pids = findPreflightProcesses('obs', processes, configs.obs.path, resolvedPath).map((item) => item.pid);
        lastProcessRefreshAt = now;
      }
      if (pids.length === 0) {
        await delay(300);
        continue;
      }
      const action = await this.windows.resolveOBSStartupDialog(pids);
      if (action === 'missing_files') return;
      if (action === 'normal_mode') {
        await delay(250);
        continue;
      }
      const windows = await this.windows.listWindows(pids);
      if (windows.some((window) => !selectOBSProjectorWindow([window]) && window.bounds.width >= 640 && window.bounds.height >= 360)) return;
      await delay(180);
    }
  }

  private async appWindowHandles(id: PreflightAppId, configs: PreflightAppConfigs): Promise<Set<string>> {
    if (process.platform !== 'win32') return new Set();
    const windows = await this.windowsForApp(id, configs, await readProcessList(true));
    return new Set(windows.map((window) => window.handle));
  }

  private async placementDisplays(): Promise<PlacementDisplay[]> {
    if (process.platform !== 'win32') return [];
    try {
      const nativeDisplays = await this.windows.listDisplays();
      if (nativeDisplays.length > 0) return nativeDisplays;
    } catch {
      // Keep layout capture available on restricted Windows installations.
    }
    return electronPlacementDisplays();
  }
}

async function readProcessList(forceRefresh = false): Promise<ProcessEntry[]> {
  const now = Date.now();
  if (!forceRefresh && processListCache && processListCache.expiresAt > now) {
    return processListCache.promise;
  }

  const promise = queryProcessList();
  processListCache = { expiresAt: now + PROCESS_LIST_CACHE_MS, promise };
  try {
    return await promise;
  } catch (error) {
    if (processListCache?.promise === promise) processListCache = null;
    throw error;
  }
}

async function queryProcessList(): Promise<ProcessEntry[]> {
  if (process.platform === 'win32') {
    try {
      const command = [
        "$ErrorActionPreference = 'Stop'",
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        '@(Get-Process -ErrorAction SilentlyContinue | ForEach-Object {',
        "  $executablePath = ''",
        '  try { $executablePath = [string]$_.Path } catch {}',
        "  [PSCustomObject]@{ pid = [int]$_.Id; name = [string]$_.ProcessName; executablePath = $executablePath; commandLine = ''; windowTitle = [string]$_.MainWindowTitle }",
        '}) | ConvertTo-Json -Compress'
      ].join('\r\n');
      const encoded = Buffer.from(command, 'utf16le').toString('base64');
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encoded
      ], { windowsHide: true, timeout: 6_000, maxBuffer: 8 * 1024 * 1024 });
      const processes = parseWindowsProcessJson(stdout);
      if (processes.length > 0) return processes;
    } catch {
      // Older or restricted Windows environments fall back to tasklist.
    }

    const { stdout } = await execFileAsync('tasklist.exe', ['/fo', 'csv', '/nh'], {
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 4 * 1024 * 1024
    });
    return parseWindowsTaskList(stdout);
  }
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,comm='], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 });
  return parsePosixProcessList(stdout);
}

function shortcutDetails(path: string): ShortcutDetails | null {
  if (process.platform !== 'win32' || !path.toLowerCase().endsWith('.lnk')) return null;
  try {
    const details = shell.readShortcutLink(path);
    return details.target ? details : null;
  } catch {
    return null;
  }
}

async function launchWindowsPathWithUrl(target: string, launchUrl: string, shortcutArgs: string, cwd: string, windowArgument: string): Promise<void> {
  const payload = JSON.stringify({ target, launchUrl, shortcutArgs, cwd, windowArgument });
  const command = `
$payload = ConvertFrom-Json $env:OBS_GUARD_PREFLIGHT_LAUNCH
$arguments = @()
if ($payload.shortcutArgs) { $arguments += [string]$payload.shortcutArgs }
if ($payload.windowArgument) { $arguments += [string]$payload.windowArgument }
$arguments += [string]$payload.launchUrl
$start = @{ FilePath = [string]$payload.target; ArgumentList = $arguments }
if ($payload.cwd -and (Test-Path -LiteralPath $payload.cwd)) { $start.WorkingDirectory = [string]$payload.cwd }
Start-Process @start
`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    timeout: 30_000,
    env: { ...process.env, OBS_GUARD_PREFLIGHT_LAUNCH: payload }
  });
}

async function launchWindowsPathWithArguments(target: string, shortcutArgs: string, cwd: string, extraArgs: string[]): Promise<void> {
  const payload = JSON.stringify({ target, shortcutArgs, cwd, extraArgs });
  const command = `
$ErrorActionPreference = 'Stop'
$payload = ConvertFrom-Json $env:OBS_GUARD_PREFLIGHT_LAUNCH
$arguments = @()
if ($payload.shortcutArgs) { $arguments += [string]$payload.shortcutArgs }
foreach ($argument in @($payload.extraArgs)) { if ($argument) { $arguments += [string]$argument } }
$start = @{ FilePath = [string]$payload.target; ArgumentList = $arguments }
if ($payload.cwd -and (Test-Path -LiteralPath $payload.cwd)) { $start.WorkingDirectory = [string]$payload.cwd }
Start-Process @start
`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    timeout: 30_000,
    env: { ...process.env, OBS_GUARD_PREFLIGHT_LAUNCH: payload }
  });
}

function electronPlacementDisplays(): PlacementDisplay[] {
  if (process.platform !== 'win32') return [];
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    label: display.label || `显示器 ${display.id}`,
    workArea: { ...display.workArea },
    primary: display.id === primaryId
  }));
}

function validatedLaunchUrl(value: string): string {
  const candidate = value.trim();
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    // The UI will keep the invalid value visible until the user corrects it.
  }
  throw new Error('浏览器页面地址必须以 http:// 或 https:// 开头');
}

function status(id: PreflightAppId, path: string, state: PreflightAppStatus['state'], message: string): PreflightAppStatus {
  return { id, path, state, message, pid: null, detectedProcessName: null };
}

function platformLabel(): PreflightCheckResult['platform'] {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
}

function errorMessage(error: unknown, fallback: string): string {
  console.error('[preflight]', error);
  return preflightError(error, fallback + '，请检查软件状态后重试；详情已写入日志');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
