import { execFile, spawn } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { PreflightRect, PreflightWindowState } from '../shared/types.js';

const execFileAsync = promisify(execFile);

export interface WindowsTopLevelWindow {
  handle: string;
  pid: number;
  title: string;
  bounds: PreflightRect;
  windowState: PreflightWindowState;
}

export class WindowsWindowManager {
  async listWindows(pids: number[]): Promise<WindowsTopLevelWindow[]> {
    if (process.platform !== 'win32' || pids.length === 0) return [];
    const output = await runPowerShell(`
$payload = ConvertFrom-Json $env:OBS_GUARD_PREFLIGHT_PAYLOAD
[OBSGuardWindowApi]::ListWindows(($payload.pids -join ',')) | ConvertTo-Json -Compress
`, { pids: [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))] });
    return parseWindowsWindowList(output);
  }

  async moveWindow(handle: string, bounds: PreflightRect, windowState: PreflightWindowState): Promise<void> {
    if (process.platform !== 'win32') throw new Error('窗口布局恢复仅支持 Windows');
    await runPowerShell(`
$payload = ConvertFrom-Json $env:OBS_GUARD_PREFLIGHT_PAYLOAD
$ok = [OBSGuardWindowApi]::MoveWindow([long]$payload.handle, [int]$payload.x, [int]$payload.y, [int]$payload.width, [int]$payload.height, [bool]$payload.maximized)
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

  async launchElevated(target: string, launchUrl: string, placement?: { bounds: PreflightRect; windowState: PreflightWindowState }, processExecutable = target): Promise<void> {
    if (process.platform !== 'win32') throw new Error('管理员启动仅支持 Windows');
    const processName = basename(processExecutable).replace(/\.(?:exe|lnk)$/i, '');
    const innerScript = `${WINDOW_API_SOURCE}\n${ELEVATED_LAUNCH_SCRIPT}`;
    const innerEncoded = Buffer.from(innerScript, 'utf16le').toString('base64');
    const payload = Buffer.from(JSON.stringify({
      target,
      launchUrl,
      processName,
      placement: placement ? {
        ...placement.bounds,
        maximized: placement.windowState === 'maximized'
      } : null
    }), 'utf8').toString('base64');

    await new Promise<void>((resolve, reject) => {
      const outer = Buffer.from(`
$env:OBS_GUARD_ELEVATED_PAYLOAD = '${payload}'
Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${innerEncoded}')
`, 'utf16le').toString('base64');
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', outer], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }
}

export function selectMainWindow(windows: WindowsTopLevelWindow[]): WindowsTopLevelWindow | null {
  return [...windows]
    .filter((window) => !isOBSProjectorWindow(window))
    .sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height)[0] ?? null;
}

export function selectOBSProjectorWindow(windows: WindowsTopLevelWindow[]): WindowsTopLevelWindow | null {
  return windows.find(isOBSProjectorWindow) ?? null;
}

export function isOBSProjectorWindow(window: WindowsTopLevelWindow): boolean {
  const title = window.title.toLocaleLowerCase('zh-CN');
  return /projector|投影|节目输出|program output/.test(title) && !/multiview|多画面/.test(title);
}

async function runPowerShell(script: string, payload: unknown): Promise<string> {
  const encoded = Buffer.from(`${WINDOW_API_SOURCE}\n${script}`, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      OBS_GUARD_PREFLIGHT_PAYLOAD: JSON.stringify(payload)
    }
  });
  return stdout.trim();
}

export function parseWindowsWindowList(output: string): WindowsTopLevelWindow[] {
  if (!output.trim()) return [];
  const parsed = JSON.parse(output) as unknown;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.flatMap((item) => windowsTopLevelWindowValue(item));
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

public static class OBSGuardWindowApi {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct WINDOWPLACEMENT {
    public int length; public int flags; public int showCmd; public POINT ptMinPosition; public POINT ptMaxPosition; public RECT rcNormalPosition;
  }

  public sealed class Bounds { public int x; public int y; public int width; public int height; }
  public sealed class WindowInfo { public string handle; public int pid; public string title; public Bounds bounds; public string windowState; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

  public static List<WindowInfo> ListWindows(string pidCsv) {
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
    var hWnd = new IntPtr(handle);
    ShowWindowAsync(hWnd, 9);
    bool moved = SetWindowPos(hWnd, IntPtr.Zero, x, y, width, height, 0x0044);
    if (moved && maximized) ShowWindowAsync(hWnd, 3);
    return moved;
  }
}
'@
`;

const ELEVATED_LAUNCH_SCRIPT = `
$payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:OBS_GUARD_ELEVATED_PAYLOAD))
$payload = ConvertFrom-Json $payloadJson
$before = @((Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id))
$arguments = @()
if ($payload.launchUrl) { $arguments += [string]$payload.launchUrl }
if ($arguments.Count -gt 0) { Start-Process -FilePath $payload.target -ArgumentList $arguments } else { Start-Process -FilePath $payload.target }
if ($payload.placement) {
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 250
    $candidate = Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $_.MainWindowHandle -ne 0 -and $before -notcontains $_.Id -and (!$payload.processName -or $_.ProcessName -eq $payload.processName)
    } | Sort-Object StartTime | Select-Object -Last 1
  } while (-not $candidate -and [DateTime]::UtcNow -lt $deadline)
  if ($candidate) {
    [void][OBSGuardWindowApi]::MoveWindow([long]$candidate.MainWindowHandle, [int]$payload.placement.x, [int]$payload.placement.y, [int]$payload.placement.width, [int]$payload.placement.height, [bool]$payload.placement.maximized)
  }
}
`;
