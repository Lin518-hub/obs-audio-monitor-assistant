import { screen, shell } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { discoverPreflightApps } from './preflightDiscovery.js';
import { WindowsWindowManager, selectMainWindow, selectOBSProjectorWindow, type WindowsTopLevelWindow } from './windowsWindowManager.js';
import { findPreflightProcess, findPreflightProcesses, parsePosixProcessList, parseWindowsTaskList, type ProcessEntry } from '../shared/preflight.js';
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

export class PreflightCheckService {
  private readonly windows = new WindowsWindowManager();

  async check(configs: PreflightAppConfigs): Promise<PreflightCheckResult> {
    const platform = platformLabel();
    let processes: ProcessEntry[];
    try {
      processes = await readProcessList();
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
      const resolvedPath = await resolveShortcutTarget(configuredPath);
      const running = findPreflightProcess(id, processes, configuredPath, resolvedPath);
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
    const displays = placementDisplays();
    const placements = { ...settings.windowPlacements };
    const captured: PreflightPlacementTarget[] = [];

    for (const id of PREFLIGHT_APP_IDS) {
      if (!settings.apps[id].restoreWindowPosition) continue;
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

    if (settings.projector.enabled && settings.projector.restoreWindowPosition) {
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

    if (current?.state !== 'running') {
      try {
        const placement = settings.apps[id].restoreWindowPosition ? settings.windowPlacements[id] : undefined;
        await this.launchConfiguredApp(id, settings.apps, placement);
        launched.push(id);
        if (id !== 'cosmic_cat' && placement) {
          try {
            await this.waitAndRestoreApp(id, settings.apps, placement);
            restored.push(id);
          } catch (error) {
            restoreFailures[id] = errorMessage(error, '窗口位置恢复失败');
          }
        } else if (id === 'cosmic_cat' && placement) {
          restored.push(id);
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

    for (const id of PREFLIGHT_APP_IDS) {
      if (!settings.apps[id].enabled || before.apps.find((app) => app.id === id)?.state === 'running') continue;
      try {
        const placement = settings.apps[id].restoreWindowPosition ? settings.windowPlacements[id] : undefined;
        await this.launchConfiguredApp(id, settings.apps, placement);
        launched.push(id);
      } catch (error) {
        failures[id] = errorMessage(error, '启动失败');
      }
    }

    await Promise.all(launched.map(async (id) => {
      const placement = settings.apps[id].restoreWindowPosition ? settings.windowPlacements[id] : undefined;
      if (!placement) return;
      if (id === 'cosmic_cat') {
        restored.push(id);
        return;
      }
      try {
        await this.waitAndRestoreApp(id, settings.apps, placement);
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
    const resolved = resolveWindowPlacement(placement, placementDisplays());
    await this.windows.moveWindow(window.handle, resolved.bounds, resolved.windowState);
  }

  private async launchConfiguredApp(id: PreflightAppId, configs: PreflightAppConfigs, placement?: PreflightWindowPlacement): Promise<void> {
    const config = configs[id];
    const target = config.path.trim();
    if (id === 'cosmic_cat' && process.platform !== 'win32') throw new Error('宇宙猫检测的管理员启动仅支持 Windows');
    if (!target) throw new Error('请先设置快捷方式或程序路径');
    if (!existsSync(target)) throw new Error('快捷方式或程序路径已失效');

    const launchUrl = id === 'browser' ? validatedLaunchUrl(config.launchUrl) : '';
    const resolvedShortcutTarget = await resolveShortcutTarget(target);
    if (id === 'cosmic_cat') {
      const resolved = placement ? resolveWindowPlacement(placement, placementDisplays()) : undefined;
      await this.windows.launchElevated(target, launchUrl, resolved, resolvedShortcutTarget || target);
      return;
    }

    if (process.platform === 'win32' && launchUrl) {
      await launchWindowsPathWithUrl(resolvedShortcutTarget || target, launchUrl);
      return;
    }
    const result = await shell.openPath(target);
    if (result) throw new Error(result);
  }

  private async waitAndRestoreApp(id: PreflightAppId, configs: PreflightAppConfigs, placement: PreflightWindowPlacement): Promise<void> {
    if (process.platform !== 'win32') return;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const windows = await this.windowsForApp(id, configs, await readProcessList());
      const mainWindow = selectMainWindow(windows);
      if (mainWindow) {
        await this.restoreWindow(mainWindow, placement);
        return;
      }
      await delay(250);
    }
    throw new Error('软件已启动，但未在 15 秒内出现可恢复的主窗口');
  }

  private async windowsForApp(id: PreflightAppId, configs: PreflightAppConfigs, processes: ProcessEntry[]): Promise<WindowsTopLevelWindow[]> {
    const resolvedPath = await resolveShortcutTarget(configs[id].path);
    const matches = findPreflightProcesses(id, processes, configs[id].path, resolvedPath);
    return this.windows.listWindows(matches.map((process) => process.pid));
  }
}

async function readProcessList(): Promise<ProcessEntry[]> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('tasklist.exe', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return parseWindowsTaskList(stdout);
  }
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,comm='], { maxBuffer: 4 * 1024 * 1024 });
  return parsePosixProcessList(stdout);
}

async function resolveShortcutTarget(path: string): Promise<string> {
  if (process.platform !== 'win32' || !path.toLowerCase().endsWith('.lnk')) return '';
  try {
    return shell.readShortcutLink(path).target;
  } catch {
    return '';
  }
}

async function launchWindowsPathWithUrl(target: string, launchUrl: string): Promise<void> {
  const payload = JSON.stringify({ target, launchUrl });
  const command = `
$payload = ConvertFrom-Json $env:OBS_GUARD_PREFLIGHT_LAUNCH
Start-Process -FilePath $payload.target -ArgumentList @([string]$payload.launchUrl)
`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    env: { ...process.env, OBS_GUARD_PREFLIGHT_LAUNCH: payload }
  });
}

function placementDisplays(): PlacementDisplay[] {
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
