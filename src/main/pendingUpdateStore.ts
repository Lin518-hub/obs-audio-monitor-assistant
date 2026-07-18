import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface PendingUpdate {
  version: string;
  downloadedAt: number;
  filePath: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  installAttempts: number;
  lastInstallAttemptAt: number | null;
}

export class PendingUpdateStore {
  private readonly path: string;

  constructor(userDataPath: string) {
    this.path = join(userDataPath, 'pending-update.json');
  }

  async load(): Promise<PendingUpdate | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<PendingUpdate>;
      const version = typeof parsed.version === 'string' ? parsed.version.trim() : '';
      if (!version) return null;
      return {
        version,
        downloadedAt: finiteTimestamp(parsed.downloadedAt),
        filePath: typeof parsed.filePath === 'string' && parsed.filePath.trim() ? parsed.filePath : null,
        sourceLabel: typeof parsed.sourceLabel === 'string' ? parsed.sourceLabel.trim().slice(0, 160) : '',
        sourceUrl: typeof parsed.sourceUrl === 'string' && parsed.sourceUrl.trim() ? parsed.sourceUrl.trim() : null,
        installAttempts: clampInteger(parsed.installAttempts, 0, 10),
        lastInstallAttemptAt: parsed.lastInstallAttemptAt == null ? null : finiteTimestamp(parsed.lastInstallAttemptAt)
      };
    } catch {
      return null;
    }
  }

  async save(update: PendingUpdate): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(update, null, 2)}\n`, 'utf8');
      // Windows does not reliably replace an existing destination with rename.
      await rm(this.path, { force: true });
      await rename(temporaryPath, this.path);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  async recordInstallAttempt(update: PendingUpdate): Promise<PendingUpdate> {
    const next = {
      ...update,
      installAttempts: update.installAttempts + 1,
      lastInstallAttemptAt: Date.now()
    };
    await this.save(next);
    return next;
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

export async function fileExists(path: string | null): Promise<boolean> {
  if (!path) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function versionParts(value: string): number[] {
  const normalized = value.trim().replace(/^v/i, '').split('-')[0];
  return normalized.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  });
}

function finiteTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function clampInteger(value: unknown, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, parsed));
}
