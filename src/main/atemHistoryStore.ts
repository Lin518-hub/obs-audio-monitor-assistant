import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ATEMSwitchHistoryEntry } from '../shared/types.js';

const MAX_HISTORY = 200;

export class ATEMHistoryStore {
  private readonly path = join(app.getPath('userData'), 'atem-switch-history.json');
  private entries: ATEMSwitchHistoryEntry[] = [];
  private persistQueue: Promise<void> = Promise.resolve();

  async load(): Promise<ATEMSwitchHistoryEntry[]> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as ATEMSwitchHistoryEntry[];
      this.entries = Array.isArray(parsed) ? parsed.filter(isValidEntry).slice(0, MAX_HISTORY) : [];
    } catch {
      this.entries = [];
    }

    return this.list();
  }

  list(): ATEMSwitchHistoryEntry[] {
    return [...this.entries];
  }

  async add(entry: ATEMSwitchHistoryEntry): Promise<ATEMSwitchHistoryEntry[]> {
    this.entries = [entry, ...this.entries].slice(0, MAX_HISTORY);
    await this.queuePersist();
    return this.list();
  }

  async clear(): Promise<ATEMSwitchHistoryEntry[]> {
    this.entries = [];
    await this.queuePersist();
    return this.list();
  }

  private queuePersist(): Promise<void> {
    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(this.path, `${JSON.stringify(this.entries, null, 2)}\n`, 'utf8');
      });
    return this.persistQueue;
  }
}

function isValidEntry(value: unknown): value is ATEMSwitchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ATEMSwitchHistoryEntry>;
  return typeof entry.id === 'string'
    && Number.isFinite(entry.switchedAt)
    && Number.isFinite(entry.fromInputId)
    && typeof entry.fromInputLabel === 'string'
    && Number.isFinite(entry.toInputId)
    && typeof entry.toInputLabel === 'string'
    && Number.isFinite(entry.startedAt)
    && Number.isFinite(entry.durationSeconds);
}
