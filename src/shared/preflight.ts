import { PREFLIGHT_APP_IDS, type PreflightAppId } from './types.js';

export interface ProcessEntry {
  pid: number;
  name: string;
  command: string;
}

const PROCESS_ALIASES: Record<PreflightAppId, string[]> = {
  obs: ['obs64', 'obs32', 'obs'],
  douyin: [
    '直播伴侣',
    '直播伴侣客户端',
    '抖音直播伴侣',
    '淘宝直播',
    '美团直播',
    'douyinlive',
    'douyinlivestudio',
    'douyinlivecompanion',
    'livestudio',
    'livecompanion',
    'liveassistant',
    'streamingtool',
    'bytelive',
    'byteliveassistant'
  ],
  browser: ['chrome', 'googlechrome', 'msedge', 'microsoftedge', 'firefox', 'safari', '360chrome', '360se', 'qqbrowser'],
  software_control: ['softwarecontrol'],
  cosmic_cat: ['宇宙猫检测', '宇宙猫', 'cosmiccat']
};

export function parseWindowsTaskList(output: string): ProcessEntry[] {
  return output
    .split(/\r?\n/)
    .map((line) => parseCsvLine(line.trim()))
    .filter((fields) => fields.length >= 2)
    .map((fields) => ({
      pid: Number.parseInt(fields[1] ?? '', 10),
      name: fields[0] ?? '',
      command: fields[0] ?? ''
    }))
    .filter((entry) => entry.name.length > 0 && Number.isFinite(entry.pid));
}

export function parseWindowsProcessJson(output: string): ProcessEntry[] {
  const trimmed = output.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const value = row as Record<string, unknown>;
    const pid = numberValue(value.pid ?? value.ProcessId);
    const name = stringValue(value.name ?? value.Name);
    const executablePath = stringValue(value.executablePath ?? value.ExecutablePath);
    const commandLine = stringValue(value.commandLine ?? value.CommandLine);
    if (!Number.isFinite(pid) || !name) return [];
    return [{ pid, name, command: executablePath || commandLine || name }];
  });
}

export function parsePosixProcessList(output: string): ProcessEntry[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      const command = match[2].trim();
      return {
        pid: Number.parseInt(match[1], 10),
        name: portableBasename(command),
        command
      } satisfies ProcessEntry;
    })
    .filter((entry): entry is ProcessEntry => entry !== null && Number.isFinite(entry.pid));
}

export function findPreflightProcess(
  id: PreflightAppId,
  processes: ProcessEntry[],
  configuredPath = '',
  resolvedShortcutPath = ''
): ProcessEntry | null {
  return findPreflightProcesses(id, processes, configuredPath, resolvedShortcutPath)[0] ?? null;
}

export function findPreflightProcesses(
  id: PreflightAppId,
  processes: ProcessEntry[],
  configuredPath = '',
  resolvedShortcutPath = ''
): ProcessEntry[] {
  const configuredNames = [configuredPath, resolvedShortcutPath]
    .map((value) => normalizeProcessName(portableBasename(value)))
    .filter(Boolean);
  const aliases = [...new Set([
    ...PROCESS_ALIASES[id].map(normalizeProcessName),
    ...configuredNames
  ].filter(Boolean))];
  const installDirectories = [resolvedShortcutPath, configuredPath]
    .filter((value) => value && !/\.(?:lnk|bat|cmd)$/i.test(value))
    .map((value) => normalizePortablePath(portableDirname(value)))
    .filter((value) => value.length >= 4);

  return processes.filter((process) => {
    const processExecutable = commandExecutable(process.command);
    const normalizedExecutable = normalizePortablePath(processExecutable);
    if (normalizedExecutable && installDirectories.some((directory) => normalizedExecutable.startsWith(`${directory}/`))) {
      return true;
    }
    const candidates = [
      process.name,
      portableBasename(process.command),
      portableBasename(processExecutable)
    ].map(normalizeProcessName).filter(Boolean);
    return candidates.some((candidate) => aliases.some((alias) => candidate === alias || (alias.length >= 6 && candidate.startsWith(alias))));
  });
}

export function isPreflightAppId(value: unknown): value is PreflightAppId {
  return typeof value === 'string' && (PREFLIGHT_APP_IDS as readonly string[]).includes(value);
}

export function normalizeProcessName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\.(?:exe|app|lnk|bat|cmd)$/i, '')
    .replace(/[\s_\-().]/g, '');
}

export function browserNewWindowArgument(executablePath: string): string {
  const name = normalizeProcessName(portableBasename(executablePath));
  if (['chrome', 'googlechrome', 'msedge', 'microsoftedge', '360chrome', '360se', 'qqbrowser'].includes(name)) {
    return '--new-window';
  }
  if (name === 'firefox') return '-new-window';
  return '';
}

function portableBasename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
}

function portableDirname(value: string): string {
  const parts = value.split(/[\\/]/);
  parts.pop();
  return parts.join('/');
}

function normalizePortablePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLocaleLowerCase('en-US');
}

function commandExecutable(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/\.(?:exe|com|bat|cmd)$/i.test(trimmed)) return trimmed;
  const quoted = trimmed.match(/^"([^"]+)"/);
  return quoted?.[1] ?? trimmed.split(/\s+/)[0] ?? trimmed;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseInt(value, 10);
  return Number.NaN;
}

function parseCsvLine(line: string): string[] {
  if (!line) return [];
  const fields: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
}
