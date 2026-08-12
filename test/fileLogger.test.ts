import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installFileLogger } from '../src/main/fileLogger.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('main file logger', () => {
  it('writes errors, reports their summary and rotates bounded files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'obs-file-logger-'));
    directories.push(directory);
    const errors: string[] = [];
    const logger = installFileLogger({ directory, maxBytes: 90, retainedFiles: 2, onError: (value) => errors.push(value) });
    try {
      console.error('first diagnostic', { code: 1 });
      console.warn('x'.repeat(120));
      console.log('last line');
      await logger.flush();
    } finally {
      logger.restoreConsole();
    }

    expect(errors).toEqual(['first diagnostic { code: 1 }']);
    expect(readdirSync(directory).filter((name) => name.startsWith('main.log')).length).toBeLessThanOrEqual(2);
    expect(readdirSync(directory)).toContain('main.log');
    expect(readFileSync(join(directory, 'main.log'), 'utf8')).toContain('last line');
  });
});
