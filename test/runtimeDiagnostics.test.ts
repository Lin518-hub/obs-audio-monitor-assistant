import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { crashRestartArgs } from '../src/main/crashRecovery.js';
import { redactSensitiveText, RuntimeDiagnosticsStore } from '../src/main/runtimeDiagnostics.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('runtime diagnostics', () => {
  it('persists and coalesces repeated errors for the next app process', () => {
    const directory = mkdtempSync(join(tmpdir(), 'obs-runtime-diagnostics-'));
    directories.push(directory);
    const filePath = join(directory, 'runtime-error.json');
    const store = new RuntimeDiagnosticsStore(filePath);
    store.record('renderer_gone_crashed', 'floating', 'renderer crashed', 1000);
    store.record('renderer_gone_crashed', 'floating', 'renderer crashed', 2000);

    const restored = new RuntimeDiagnosticsStore(filePath).getRecent(10_000, 2500);
    expect(restored).toMatchObject({
      code: 'renderer_gone_crashed',
      source: 'floating',
      message: 'renderer crashed',
      occurredAt: 2000,
      count: 2
    });
    expect(JSON.parse(readFileSync(filePath, 'utf8')).count).toBe(2);
  });

  it('does not report stale errors forever', () => {
    const directory = mkdtempSync(join(tmpdir(), 'obs-runtime-diagnostics-'));
    directories.push(directory);
    const store = new RuntimeDiagnosticsStore(join(directory, 'runtime-error.json'));
    store.record('old_error', 'main', 'old', 1000);
    expect(store.getRecent(500, 2000)).toBeNull();
  });

  it('redacts credentials before persistence or upload', () => {
    expect(redactSensitiveText('https://example.com/hook?key=visible&token=also-visible'))
      .toBe('https://example.com/hook?key=[REDACTED]&token=[REDACTED]');
    expect(redactSensitiveText('Authorization: Bearer abc123'))
      .toBe('Authorization: Bearer [REDACTED]');
    expect(redactSensitiveText('password="abc123"')).toBe('password="[REDACTED]"');
  });
});

describe('main-process crash restart guard', () => {
  it('allows two restarts in five minutes and then stops the loop', () => {
    const first = crashRestartArgs(['app.js'], 1000);
    expect(first).toEqual(['app.js', '--main-crash-restarts=1000']);
    const second = crashRestartArgs(first ?? [], 2000);
    expect(second).toEqual(['app.js', '--main-crash-restarts=1000,2000']);
    expect(crashRestartArgs(second ?? [], 3000)).toBeNull();
  });

  it('forgets restart attempts outside the recovery window', () => {
    expect(crashRestartArgs(['app.js', '--main-crash-restarts=1000,2000'], 400_000))
      .toEqual(['app.js', '--main-crash-restarts=400000']);
  });
});
