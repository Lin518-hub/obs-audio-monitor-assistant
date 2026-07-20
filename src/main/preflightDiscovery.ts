import { shell } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { PREFLIGHT_APP_IDS, type PreflightAppId, type PreflightDiscoveryItem, type PreflightDiscoveryResult, type PreflightPathSource } from '../shared/types.js';

const execFileAsync = promisify(execFile);

export interface DiscoveryCandidate extends PreflightDiscoveryItem {
  priority: number;
}

const SOURCE_PRIORITY: Record<PreflightPathSource, number> = {
  standard: 0,
  registry: 1,
  start_menu: 2,
  desktop: 3,
  manual: 4,
  unknown: 5
};

const SHORTCUT_PATTERNS: Record<PreflightAppId, RegExp> = {
  obs: /(^|\s)obs(?: studio)?($|\s)|obs直播/i,
  douyin: /抖音|淘宝直播|美团直播|千牛直播|直播伴侣|直播工具|直播助手|主播工作台|主播工具|live\s*studio|live\s*companion|webcast\s*mate/i,
  browser: /google chrome|谷歌浏览器|microsoft edge|微软 edge|firefox|火狐|360.*浏览器|qq浏览器/i,
  software_control: /atem.*software control|software control/i,
  cosmic_cat: /宇宙猫|cosmic\s*cat/i
};

export async function discoverPreflightApps(): Promise<PreflightDiscoveryResult> {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
  if (process.platform !== 'win32') {
    return { platform, discovered: [], message: '自动发现仅在 Windows 上可用，请手动选择应用。' };
  }

  const candidates: DiscoveryCandidate[] = [];
  candidates.push(...standardCandidates());
  candidates.push(...await registryCandidates());
  candidates.push(...await shortcutCandidates());
  const discovered = chooseBestCandidates(candidates);
  return {
    platform,
    discovered,
    message: discovered.length > 0 ? `自动发现 ${discovered.length} 个开播应用。` : '未发现常用开播应用，可继续手动设置。'
  };
}

export function chooseBestCandidates(candidates: DiscoveryCandidate[]): PreflightDiscoveryItem[] {
  return PREFLIGHT_APP_IDS.flatMap((id) => {
    const best = candidates
      .filter((candidate) => candidate.id === id && candidate.path && existsSync(candidate.path))
      .sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path, 'zh-CN'))[0];
    return best ? [{ id, path: best.path, source: best.source }] : [];
  });
}

export function matchShortcutAppId(name: string): PreflightAppId | null {
  return PREFLIGHT_APP_IDS.find((id) => SHORTCUT_PATTERNS[id].test(name)) ?? null;
}

function standardCandidates(): DiscoveryCandidate[] {
  const env = process.env;
  const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)']].filter((value): value is string => Boolean(value));
  const localAppData = env.LOCALAPPDATA;
  const paths: Array<[PreflightAppId, string | undefined]> = [
    ['obs', env.ProgramFiles ? join(env.ProgramFiles, 'obs-studio', 'bin', '64bit', 'obs64.exe') : undefined],
    ['obs', env['ProgramFiles(x86)'] ? join(env['ProgramFiles(x86)'], 'obs-studio', 'bin', '32bit', 'obs32.exe') : undefined],
    ['douyin', localAppData ? join(localAppData, 'Programs', 'DouyinLive', 'DouyinLive.exe') : undefined],
    ['douyin', localAppData ? join(localAppData, 'Programs', 'DouyinLiveCompanion', 'DouyinLiveCompanion.exe') : undefined],
    ['douyin', localAppData ? join(localAppData, 'Programs', '抖音直播伴侣', '抖音直播伴侣.exe') : undefined],
    ['douyin', localAppData ? join(localAppData, 'Programs', '抖音直播伴侣', '直播伴侣.exe') : undefined],
    ['douyin', localAppData ? join(localAppData, 'DouyinLive', 'DouyinLive.exe') : undefined],
    ['browser', env['ProgramFiles(x86)'] ? join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined],
    ['browser', env.ProgramFiles ? join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined],
    ['browser', localAppData ? join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined],
    ['browser', env.ProgramFiles ? join(env.ProgramFiles, 'Mozilla Firefox', 'firefox.exe') : undefined]
  ];
  for (const root of programFiles) {
    paths.push(['douyin', join(root, 'DouyinLive', 'DouyinLive.exe')]);
    paths.push(['douyin', join(root, '抖音直播伴侣', '抖音直播伴侣.exe')]);
    paths.push(['douyin', join(root, '抖音直播伴侣', '直播伴侣.exe')]);
    paths.push(['software_control', join(root, 'Blackmagic Design', 'Blackmagic ATEM Switchers', 'ATEM Software Control', 'ATEM Software Control.exe')]);
    paths.push(['software_control', join(root, 'Blackmagic Design', 'ATEM Switchers', 'ATEM Software Control', 'ATEM Software Control.exe')]);
  }
  return paths.flatMap(([id, path]) => path && existsSync(path)
    ? [{ id, path, source: 'standard' as const, priority: SOURCE_PRIORITY.standard }]
    : []);
}

async function registryCandidates(): Promise<DiscoveryCandidate[]> {
  const entries: Array<[PreflightAppId, string]> = [
    ['obs', 'obs64.exe'],
    ['obs', 'obs32.exe'],
    ['douyin', '直播伴侣.exe'],
    ['douyin', '抖音直播伴侣.exe'],
    ['douyin', 'DouyinLive.exe'],
    ['douyin', 'DouyinLiveCompanion.exe'],
    ['douyin', 'LiveStudio.exe'],
    ['douyin', 'ByteLive.exe'],
    ['douyin', 'WebcastMate.exe'],
    ['douyin', 'MTLive.exe'],
    ['douyin', 'TaobaoLive.exe'],
    ['douyin', 'TaobaoLiveStudio.exe'],
    ['douyin', 'QnLiveStudio.exe'],
    ['browser', 'msedge.exe'],
    ['browser', 'chrome.exe'],
    ['browser', 'firefox.exe'],
    ['software_control', 'ATEM Software Control.exe']
  ];
  const candidates = await Promise.all(entries.map(async ([id, executable]) => {
    const roots = [
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executable}`,
      `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executable}`
    ];
    for (const key of roots) {
      try {
        const { stdout } = await execFileAsync('reg.exe', ['query', key, '/ve'], { windowsHide: true, maxBuffer: 256 * 1024 });
        const path = parseRegistryDefaultPath(stdout);
        if (path && existsSync(path)) return { id, path, source: 'registry' as const, priority: SOURCE_PRIORITY.registry };
      } catch {
        // Missing App Paths entries are expected.
      }
    }
    return null;
  }));
  return candidates.flatMap((candidate) => candidate ? [candidate] : []);
}

async function shortcutCandidates(): Promise<DiscoveryCandidate[]> {
  const roots: Array<{ path: string | undefined; source: 'start_menu' | 'desktop' }> = [
    { path: process.env.ProgramData ? join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : undefined, source: 'start_menu' },
    { path: process.env.APPDATA ? join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : undefined, source: 'start_menu' },
    { path: process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Desktop') : undefined, source: 'desktop' },
    { path: process.env.PUBLIC ? join(process.env.PUBLIC, 'Desktop') : undefined, source: 'desktop' }
  ];
  const candidates: DiscoveryCandidate[] = [];
  for (const root of roots) {
    if (!root.path || !existsSync(root.path)) continue;
    const links = await listShortcutFiles(root.path, 6000);
    for (const link of links) {
      const id = matchShortcutAppId(basename(link, '.lnk'));
      if (!id) continue;
      try {
        const target = shell.readShortcutLink(link).target;
        if (!target || !existsSync(target)) continue;
        candidates.push({ id, path: link, source: root.source, priority: SOURCE_PRIORITY[root.source] });
      } catch {
        // Invalid shortcuts are ignored; the manual picker remains available.
      }
    }
  }
  return candidates;
}

async function listShortcutFiles(root: string, limit: number): Promise<string[]> {
  const result: string[] = [];
  const pending = [root];
  while (pending.length > 0 && result.length < limit) {
    const directory = pending.shift();
    if (!directory) break;
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (result.length >= limit) break;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) result.push(path);
      }
    } catch {
      // Ignore inaccessible Start Menu folders instead of requesting elevation.
    }
  }
  return result;
}

function parseRegistryDefaultPath(output: string): string {
  const match = output.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/im);
  return match?.[1]?.trim().replace(/^"|"$/g, '') ?? '';
}
