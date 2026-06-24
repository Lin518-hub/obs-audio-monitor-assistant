import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AlertHistoryEntry } from '../shared/types.js';

const MAX_HISTORY = 20;

export class HistoryStore {
  private readonly path = join(app.getPath('userData'), 'history.json');
  private entries: AlertHistoryEntry[] = [];

  async load(): Promise<AlertHistoryEntry[]> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as AlertHistoryEntry[];
      this.entries = Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
    } catch {
      this.entries = [];
    }

    return this.list();
  }

  list(): AlertHistoryEntry[] {
    return [...this.entries];
  }

  async add(entry: AlertHistoryEntry): Promise<AlertHistoryEntry[]> {
    this.entries = [entry, ...this.entries].slice(0, MAX_HISTORY);
    await this.persist();
    return this.list();
  }

  async clear(): Promise<AlertHistoryEntry[]> {
    this.entries = [];
    await this.persist();
    return this.list();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(this.entries, null, 2)}\n`, 'utf8');
  }
}
