import { screen, shell, type ShortcutDetails } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { discoverPreflightApps } from './preflightDiscovery.js';
import { WindowsWindowManager, selectMainWindow, selectOBSProjectorWindow, type WindowsTopLevelWindow } from './windowsWindowManager.js';
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
const PROCESS_LIST_CACHE_MS = 800;

let processListCache: { expiresAt: number; promise: Promise<ProcessEntry[]> } | null = null;

export class PreflightCheckService {
  private readonly windows = new WindowsWindowManager();

  async check(configs: PreflightAppConfigs): Promise<PreflightCheckResult> {
    const platform = platformLabel();
    let processes: ProcessEntry[];
    try {
      processes = await readProcessList(true);
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

  async captureLayout(settings: PreflightSettings): Promise<PreflightLayoutCaptureResult> {
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

    const processes = await readProcessList();
    const displays = await this.placementDisplays();
    const placements = { ...settings.windowPlacements };
    const captured: PreflightPlacementTarget[] = [];

    for (const id of PREFLIGHT_APP_IDS) {
      if (id === 'cosmic_cat') continue;
      if (!settings.apps[id].enabled || !settings.apps[id].restoreWindowPosition) continue;
      try {
        const windows = await this.windowsForApp(id, settings.apps, processes);
        const mainWindow = selectMainWindow(windows);
        if (!mainWindow) throw new Error('未找到可保存的主窗口，请先打开该软件');
        placements[id] = captureWindowPlacement(mainWindow.bounds, mainWindow.windowState, displays, capturedAt);
        captured.push(id);
      } catch (error) {
        failures[id] = errorMessage(error, '保存窗口位置失败');
      }
    }

    if (settings.projector.restoreWindowPosition) {
      try {
        const projector = await this.findOBSProjector(settings.apps, processes);
        if (!projector) throw new Error('未找到已打开的节目输出投影');
        placements.obs_projector = captureWindowPlacement(projector.bounds, projector.windowState, displays, capturedAt);
        captured.push('obs_projector');
      } catch (error) {
        failures.obs_projector = errorMessage(error, '保存投影位置失败');
      }
    }

    return { platform: 'windows', placements, captured, failures, capturedAt };
  }

  async launch(id: PreflightAppId, settings: PreflightSettings): Promise<PreflightLaunchResult> {
    const before = await this.check(settings.apps);
    const current = before.apps.find((app) => app.id === id);
    const failures: Partial<Record<PreflightAppId, string>> = {};
    const launched: PreflightAppId[] = [];
    const restored: PreflightPlacementTarget[] = [];
    const restoreFailures: Partial<Record<PreflightPlacementTarget, string>> = {};

    const shouldOpenBrowserPage = id === 'browser' && Boolean(settings.apps.browser.launchUrl.trim());
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

    await delay(700);
    return { ...(await this.check(settings.apps)), launched, failures, restored, restoreFailures, projector: null };
  }

  async launchAll(settings: PreflightSettings): Promise<PreflightLaunchResult> {
    const before = await this.check(settings.apps);
    const failures: Partial<Record<PreflightAppId, string>> = {};
    const launched: PreflightAppId[] = [];
    const restored: PreflightPlacementTarget[] = [];
    const restoreFailures: Partial<Record<PreflightPlacementTarget, string>> = {};
    const existingWindowHandles: Partial<Record<PreflightAppId, Set<string>>> = {};
    let shouldResolveOBSStartupDialogs = false;

    for (const id of PREFLIGHT_APP_IDS) {
      if (!settings.apps[id].enabled) continue;
      const alreadyRunning = before.apps.find((app) => app.id === id)?.state === 'running';
      if (id === 'obs' && alreadyRunning) {
        shouldResolveOBSStartupDialogs = true;
      }
      const shouldOpenBrowserPage = id === 'browser' && Boolean(settings.apps.browser.launchUrl.trim());
      if (alreadyRunning && !shouldOpenBrowserPage) continue;
      try {
        const placement = id !== 'cosmic_cat' && settings.apps[id].restoreWindowPosition ? settings.windowPlacements[id] : undefined;
        if (placement && id === 'browser') {
          existingWindowHandles[id] = await this.appWindowHandles(id, settings.apps);
        }
        await this.launchConfiguredApp(id, settings.apps, placement, id !== 'obs');
        launched.push(id);
        if (id === 'obs') shouldResolveOBSStartupDialogs = true;
      } catch (error) {
        failures[id] = errorMessage(error, '启动失败');
      }
    }

    if (shouldResolveOBSStartupDialogs) {
      await this.resolveOBSStartupDialogs(settings.apps);
    }

    await Promise.all(launched.map(async (id) => {
      const placement = id !== 'cosmic_cat' && settings.apps[id].restoreWindowPosition ? settings.windowPlacements[id] : undefined;
      if (!placement) return;
      try {
        await this.waitAndRestoreApp(id, settings.apps, placement, existingWindowHandles[id]);
        restored.push(id);
      } catch (error) {
        restoreFailures[id] = errorMessage(error, '窗口位置恢复失败');
      }
    }));

    await delay(500);
    return { ...(await this.check(settings.apps)), launched, failures, restored, restoreFailures, projector: null };
  }

  async findOBSProjector(configs: PreflightAppConfigs, processes?: ProcessEntry[]): Promise<WindowsTopLevelWindow | null> {
    if (process.platform !== 'win32') return null;
    const processList = processes ?? await readProcessList();
    const windows = await this.windowsForApp('obs', configs, processList);
    return selectOBSProjectorWindow(windows);
  }

  async waitForNewOBSProjector(configs: PreflightAppConfigs, existingHandles: Set<string>, timeoutMs = 15_000): Promise<WindowsTopLevelWindow | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const processes = await readProcessList();
      const windows = await this.windowsForApp('obs', configs, processes);
      const projector = windows.find((window) => !existingHandles.has(window.handle) && selectOBSProjectorWindow([window]));
      if (projector) return projector;
      await delay(250);
    }
    return null;
  }

  async listOBSWindowHandles(configs: PreflightAppConfigs): Promise<Set<string>> {
    if (process.platform !== 'win32') return new Set();
    const windows = await this.windowsForApp('obs', configs, await readProcessList());
    return new Set(windows.map((window) => window.handle));
  }

  async restoreWindow(window: WindowsTopLevelWindow, placement: PreflightWindowPlacement): Promise<void> {
    if (process.platform !== 'win32') return;
    const resolved = resolveWindowPlacement(placement, await this.placementDisplays());
    await this.windows.moveWindow(window.handle, resolved.bounds, resolved.windowState);
  }

  private async launchConfiguredApp(
    id: PreflightAppId,
    configs: PreflightAppConfigs,
    placement?: PreflightWindowPlacement,
    waitForOBSStartup = true
  ): Promise<void> {
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
    if (process.platform !== 'win32') return;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const windows = await this.windowsForApp(id, configs, await readProcessList());
      const mainWindow = selectMainWindow(excludedHandles
        ? windows.filter((window) => !excludedHandles.has(window.handle))
        : windows);
      if (mainWindow) {
        await this.restoreWindow(mainWindow, placement);
        return;
      }
      await delay(250);
    }
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
  return error instanceof Error && error.message ? error.message : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
