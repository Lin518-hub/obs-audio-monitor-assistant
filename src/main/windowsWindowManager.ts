import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PreflightRect, PreflightWindowState } from '../shared/types.js';
import type { PlacementDisplay } from '../shared/windowPlacement.js';

const execFileAsync = promisify(execFile);

export interface WindowsTopLevelWindow {
  handle: string;
  pid: number;
  title: string;
  bounds: PreflightRect;
  windowState: PreflightWindowState;
}

export type OBSStartupDialogAction = 'normal_mode' | 'missing_files' | null;

export class WindowsWindowManager {
  async listDisplays(): Promise<PlacementDisplay[]> {
    if (process.platform !== 'win32') return [];
    const output = await runPowerShell(`
[OBSGuardWindowApi]::ListDisplays() | ConvertTo-Json -Compress
`, {});
    return parseWindowsDisplayList(output);
  }

  async listWindows(pids: number[]): Promise<WindowsTopLevelWindow[]> {
    if (process.platform !== 'win32' || pids.length === 0) return [];
    const output = await runPowerShell(`
$payload = ConvertFrom-Json $env:OBS_GUARD_PREFLIGHT_PAYLOAD
[OBSGuardWindowApi]::ListWindows(($payload.pids -join ',')) | ConvertTo-Json -Compress
`, { pids: [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))] });
    return parseWindowsWindowList(output);
  }

  async waitForNewWindows(pids: number[], existingHandles: Set<string>, timeoutMs: number): Promise<WindowsTopLevelWindow[]> {
    if (process.platform !== 'win32' || pids.length === 0) return [];
    const output = await runPowerShell(`
$payload = ConvertFrom-Json $env:OBS_GUARD_PREFLIGHT_PAYLOAD
$known = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($handle in @($payload.existingHandles)) { [void]$known.Add([string]$handle) }
$deadline = [DateTime]::UtcNow.AddMilliseconds([int]$payload.timeoutMs)
do {
  $windows = @([OBSGuardWindowApi]::ListWindows(($payload.pids -join ',')) | Where-Object { -not $known.Contains([string]$_.handle) })
  if ($windows.Count -gt 0) {
    $windows | ConvertTo-Json -Compress
    break
  }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
`, {
      pids: normalizedPids(pids),
      existingHandles: [...existingHandles],
      timeoutMs: Math.max(250, Math.round(timeoutMs))
    }, Math.max(20_000, timeoutMs + 5_000));
    return parseWindowsWindowList(output);
  }

  async moveWindow(handle: string, bounds: PreflightRect, windowState: PreflightWindowState): Promise<void> {
    if (process.platform !== 'win32') throw new Error('窗口布局恢复仅支持 Windows');
    await runPowerShell(`
$payload = ConvertFrom-Json $env:OBS_GUARD_PREFLIGHT_PAYLOAD
$ok = [OBSGuardWindowApi]::MoveWindowStable([long]$payload.handle, [int]$payload.x, [int]$payload.y, [int]$payload.width, [int]$payload.height, [bool]$payload.maximized)
if (-not $ok) { throw '无法移动目标窗口' }
`, {
      handle,
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      maximized: windowState === 'maximized'
    });
  }

  async resolveOBSStartupDialog(pids: number[]): Promise<OBSStartupDialogAction> {
    if (process.platform !== 'win32' || pids.length === 0) return null;
    const output = await runPowerShell(`
$payload = ConvertFrom-Json $env:OBS_GUARD_PREFLIGHT_PAYLOAD
[OBSGuardWindowApi]::ResolveOBSStartupDialog(($payload.pids -join ','))
`, { pids: [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))] });
    const action = output.trim().toLocaleLowerCase('en-US');
    return action === 'normal_mode' || action === 'missing_files' ? action : null;
  }

  async launchElevated(target: string): Promise<void> {
    if (process.platform !== 'win32') throw new Error('管理员启动仅支持 Windows');
    const command = Buffer.from(`
$ErrorActionPreference = 'Stop'
$payload = ConvertFrom-Json $env:OBS_GUARD_ELEVATED_PAYLOAD
if (-not (Test-Path -LiteralPath ([string]$payload.target))) { throw '快捷方式或程序路径已失效' }
Start-Process -FilePath ([string]$payload.target) -Verb RunAs
`, 'utf16le').toString('base64');
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', command], {
      windowsHide: true,
      timeout: 60_000,
      env: {
        ...process.env,
        OBS_GUARD_ELEVATED_PAYLOAD: JSON.stringify({ target })
      }
    });
  }
}

export function selectMainWindow(windows: WindowsTopLevelWindow[]): WindowsTopLevelWindow | null {
  return [...windows]
    .filter((window) => !isAnyOBSProjectorWindow(window))
    .sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height)[0] ?? null;
}

export function selectOBSProjectorWindow(windows: WindowsTopLevelWindow[]): WindowsTopLevelWindow | null {
  return windows.find(isOBSProjectorWindow) ?? null;
}

export function selectNewOBSProjectorWindow(windows: WindowsTopLevelWindow[]): WindowsTopLevelWindow | null {
  const exact = selectOBSProjectorWindow(windows);
  if (exact) return exact;

  return [...windows]
    .filter((window) => {
      const title = window.title.toLocaleLowerCase('zh-CN');
      if (/multiview|多画面|scene|场景|source|来源|missing\s+files|缺少文件|缺失文件|safe\s+mode|安全模式/.test(title)) return false;
      return window.bounds.width >= 320 && window.bounds.height >= 180;
    })
    .sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height)[0] ?? null;
}

export function isOBSProjectorWindow(window: WindowsTopLevelWindow): boolean {
  const title = window.title.toLocaleLowerCase('zh-CN');
  if (/multiview|多画面/.test(title)) return false;
  return /(?:projector|投影).*(?:program|节目)|(?:program|节目).*(?:projector|投影)|program\s+output|节目输出/.test(title);
}

function isAnyOBSProjectorWindow(window: WindowsTopLevelWindow): boolean {
  return /projector|投影/.test(window.title.toLocaleLowerCase('zh-CN'));
}

async function runPowerShell(script: string, payload: unknown, timeout = 20_000): Promise<string> {
  const encoded = Buffer.from(`${WINDOW_API_SOURCE}\n${script}`, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    timeout,
    env: {
      ...process.env,
      OBS_GUARD_PREFLIGHT_PAYLOAD: JSON.stringify(payload)
    }
  });
  return stdout.trim();
}

function normalizedPids(pids: number[]): number[] {
  return [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
}

export function parseWindowsWindowList(output: string): WindowsTopLevelWindow[] {
  if (!output.trim()) return [];
  const parsed = JSON.parse(output) as unknown;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.flatMap((item) => windowsTopLevelWindowValue(item));
}

export function parseWindowsDisplayList(output: string): PlacementDisplay[] {
  if (!output.trim()) return [];
  const parsed = JSON.parse(output) as unknown;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.flatMap((item): PlacementDisplay[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const workArea = raw.workArea && typeof raw.workArea === 'object' && !Array.isArray(raw.workArea)
      ? raw.workArea as Record<string, unknown>
      : {};
    const id = Number(raw.id);
    const x = Number(workArea.x);
    const y = Number(workArea.y);
    const width = Number(workArea.width);
    const height = Number(workArea.height);
    if (!Number.isInteger(id) || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return [];
    return [{
      id,
      label: String(raw.label ?? ''),
      workArea: { x, y, width, height },
      primary: raw.primary === true
    }];
  });
}

function windowsTopLevelWindowValue(value: unknown): WindowsTopLevelWindow[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const raw = value as Record<string, unknown>;
  const bounds = raw.bounds && typeof raw.bounds === 'object' && !Array.isArray(raw.bounds)
    ? raw.bounds as Record<string, unknown>
    : {};
  const pid = Number(raw.pid);
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (!Number.isInteger(pid) || pid <= 0 || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return [];
  return [{
    handle: String(raw.handle ?? ''),
    pid,
    title: String(raw.title ?? ''),
    bounds: { x, y, width, height },
    windowState: raw.windowState === 'maximized' ? 'maximized' : 'normal'
  }];
}

const WINDOW_API_SOURCE = `
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public static class OBSGuardWindowApi {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public delegate bool EnumChildProc(IntPtr hWnd, IntPtr lParam);
  public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdcMonitor, ref RECT monitorRect, IntPtr data);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct WINDOWPLACEMENT {
    public int length; public int flags; public int showCmd; public POINT ptMinPosition; public POINT ptMaxPosition; public RECT rcNormalPosition;
  }

  public sealed class Bounds { public int x; public int y; public int width; public int height; }
  public sealed class WindowInfo { public string handle; public int pid; public string title; public Bounds bounds; public string windowState; }
  public sealed class DisplayInfo { public int id; public string label; public Bounds workArea; public bool primary; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)] public struct MONITORINFOEX {
    public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
  }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFOEX info);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

  static void EnablePerMonitorDpiAwareness() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
  }

  public static List<DisplayInfo> ListDisplays() {
    EnablePerMonitorDpiAwareness();
    var result = new List<DisplayInfo>();
    int fallbackId = 1;
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr monitor, IntPtr hdc, ref RECT unused, IntPtr data) {
      var info = new MONITORINFOEX(); info.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      if (!GetMonitorInfo(monitor, ref info)) return true;
      string label = info.szDevice ?? "";
      int id = 0;
      var match = System.Text.RegularExpressions.Regex.Match(label, @"DISPLAY(\\d+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
      if (!match.Success || !int.TryParse(match.Groups[1].Value, out id)) id = fallbackId;
      fallbackId++;
      result.Add(new DisplayInfo {
        id = id,
        label = label,
        workArea = new Bounds {
          x = info.rcWork.Left,
          y = info.rcWork.Top,
          width = Math.Max(1, info.rcWork.Right - info.rcWork.Left),
          height = Math.Max(1, info.rcWork.Bottom - info.rcWork.Top)
        },
        primary = (info.dwFlags & 1) != 0
      });
      return true;
    }, IntPtr.Zero);
    return result;
  }

  public static List<WindowInfo> ListWindows(string pidCsv) {
    EnablePerMonitorDpiAwareness();
    var allowed = new HashSet<int>();
    foreach (var value in (pidCsv ?? "").Split(',')) { int pid; if (int.TryParse(value, out pid)) allowed.Add(pid); }
    var result = new List<WindowInfo>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr unused) {
      uint pid; GetWindowThreadProcessId(hWnd, out pid);
      if (!allowed.Contains((int)pid) || !IsWindowVisible(hWnd)) return true;
      int length = GetWindowTextLength(hWnd);
      if (length <= 0) return true;
      var text = new StringBuilder(length + 1); GetWindowText(hWnd, text, text.Capacity);
      var placement = new WINDOWPLACEMENT(); placement.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
      RECT rect;
      if (!GetWindowPlacement(hWnd, ref placement) || !GetWindowRect(hWnd, out rect)) return true;
      bool maximized = placement.showCmd == 3;
      if (maximized || placement.showCmd == 2) rect = placement.rcNormalPosition;
      result.Add(new WindowInfo {
        handle = hWnd.ToInt64().ToString(), pid = (int)pid, title = text.ToString(),
        bounds = new Bounds { x = rect.Left, y = rect.Top, width = Math.Max(1, rect.Right - rect.Left), height = Math.Max(1, rect.Bottom - rect.Top) },
        windowState = maximized ? "maximized" : "normal"
      });
      return true;
    }, IntPtr.Zero);
    return result;
  }

  public static bool MoveWindow(long handle, int x, int y, int width, int height, bool maximized) {
    EnablePerMonitorDpiAwareness();
    var hWnd = new IntPtr(handle);
    ShowWindowAsync(hWnd, 9);
    bool moved = SetWindowPos(hWnd, IntPtr.Zero, x, y, width, height, 0x0054);
    if (moved && maximized) ShowWindowAsync(hWnd, 3);
    return moved;
  }

  public static bool MoveWindowStable(long handle, int x, int y, int width, int height, bool maximized) {
    bool moved = false;
    int[] delays = new int[] { 0, 120, 240, 480, 720, 1000 };
    foreach (int delay in delays) {
      if (delay > 0) Thread.Sleep(delay);
      moved = MoveWindow(handle, x, y, width, height, false) || moved;
    }
    Thread.Sleep(220);
    moved = MoveWindow(handle, x, y, width, height, false) || moved;
    if (moved && maximized) ShowWindowAsync(new IntPtr(handle), 3);
    return moved;
  }

  public static string ResolveOBSStartupDialog(string pidCsv) {
    var allowed = new HashSet<int>();
    foreach (var value in (pidCsv ?? "").Split(',')) { int pid; if (int.TryParse(value, out pid)) allowed.Add(pid); }
    string action = "";
    var normalButton = new Regex(@"run\s+in\s+normal\s+mode|run\s+normally|start\s+normally|normal\s+mode|正常启动|正常运行|正常模式|以正常模式", RegexOptions.IgnoreCase);
    var missingFilesTitle = new Regex(@"^\s*(missing\s+files|缺少文件|缺失文件|丢失文件)\s*$", RegexOptions.IgnoreCase);
    var cancelButton = new Regex(@"^\s*(cancel|close|取消|关闭)\s*$", RegexOptions.IgnoreCase);
    EnumWindows(delegate(IntPtr top, IntPtr unused) {
      uint pid; GetWindowThreadProcessId(top, out pid);
      if (!allowed.Contains((int)pid) || !IsWindowVisible(top)) return true;
      int topLength = GetWindowTextLength(top);
      var topText = new StringBuilder(Math.Max(1, topLength + 1));
      if (topLength > 0) GetWindowText(top, topText, topText.Capacity);
      EnumChildWindows(top, delegate(IntPtr child, IntPtr childUnused) {
        int length = GetWindowTextLength(child);
        if (length <= 0) return true;
        var text = new StringBuilder(length + 1); GetWindowText(child, text, text.Capacity);
        if (!normalButton.IsMatch(text.ToString())) return true;
        SendMessage(child, 0x00F5, IntPtr.Zero, IntPtr.Zero);
        action = "normal_mode";
        return false;
      }, IntPtr.Zero);
      if (action.Length > 0) return false;
      if (!missingFilesTitle.IsMatch(topText.ToString())) return true;
      EnumChildWindows(top, delegate(IntPtr child, IntPtr childUnused) {
        int length = GetWindowTextLength(child);
        if (length <= 0) return true;
        var text = new StringBuilder(length + 1); GetWindowText(child, text, text.Capacity);
        if (!cancelButton.IsMatch(text.ToString())) return true;
        SendMessage(child, 0x00F5, IntPtr.Zero, IntPtr.Zero);
        action = "missing_files";
        return false;
      }, IntPtr.Zero);
      if (action.Length == 0) {
        SendMessage(top, 0x0010, IntPtr.Zero, IntPtr.Zero);
        action = "missing_files";
      }
      return false;
    }, IntPtr.Zero);
    return action;
  }
}
'@
`;
