import { PREFLIGHT_APP_IDS, type PreflightAppId } from './types.js';

export interface ProcessEntry {
  pid: number;
  name: string;
  command: string;
}

const PROCESS_ALIASES: Record<PreflightAppId, string[]> = {
  obs: ['obs64', 'obs32', 'obs'],
  douyin: ['直播伴侣', '抖音直播伴侣', '淘宝直播', '美团直播', 'douyinlive', 'douyinlivecompanion', 'livestudio', 'livecompanion', 'bytelive'],
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
  const aliases = configuredNames.length > 0 ? configuredNames : PROCESS_ALIASES[id].map(normalizeProcessName);

  return processes.filter((process) => {
    const candidates = [process.name, portableBasename(process.command)].map(normalizeProcessName);
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

function portableBasename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
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
