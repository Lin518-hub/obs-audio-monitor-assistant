import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compareVersions, PendingUpdateStore } from '../src/main/pendingUpdateStore.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('PendingUpdateStore', () => {
  it('persists a staged update and records bounded install attempts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obs-pending-update-'));
    roots.push(root);
    const store = new PendingUpdateStore(root);
    await store.save({
      version: '3.7.0',
      downloadedAt: 1234,
      filePath: 'C:\\cache\\assistant.exe',
      sourceLabel: '内部服务器',
      sourceUrl: 'https://example.com/updates/',
      installAttempts: 0,
      lastInstallAttemptAt: null
    });

    const loaded = await store.load();
    expect(loaded?.version).toBe('3.7.0');
    const attempted = await store.recordInstallAttempt(loaded!);
    expect(attempted.installAttempts).toBe(1);
    expect(attempted.lastInstallAttemptAt).toBeTypeOf('number');
    expect(JSON.parse(await readFile(join(root, 'pending-update.json'), 'utf8')).installAttempts).toBe(1);

    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('compares release versions without treating a v prefix as different', () => {
    expect(compareVersions('v3.7.0', '3.6.9')).toBe(1);
    expect(compareVersions('3.6.0', '3.6.0')).toBe(0);
    expect(compareVersions('3.5.9', '3.6.0')).toBe(-1);
  });
});
