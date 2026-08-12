import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { inspect } from 'node:util';
import { join } from 'node:path';
import { redactSensitiveText } from './runtimeDiagnostics.js';

type LogLevel = 'log' | 'warn' | 'error';

interface FileLoggerOptions {
  directory: string;
  maxBytes?: number;
  retainedFiles?: number;
  onError?: (message: string) => void;
}

export interface FileLogger {
  flush: () => Promise<void>;
  restoreConsole: () => void;
}

export function installFileLogger({
  directory,
  maxBytes = 2 * 1024 * 1024,
  retainedFiles = 3,
  onError
}: FileLoggerOptions): FileLogger {
  const logFile = join(directory, 'main.log');
  const originals = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };
  let queue = Promise.resolve();
  let size = 0;
  let initialized = false;

  const initialize = async () => {
    if (initialized) return;
    await mkdir(directory, { recursive: true });
    size = await stat(logFile).then((value) => value.size).catch(() => 0);
    initialized = true;
  };

  const rotate = async () => {
    for (let index = retainedFiles - 1; index >= 1; index -= 1) {
      const source = index === 1 ? logFile : `${logFile}.${index - 1}`;
      const destination = `${logFile}.${index}`;
      await rm(destination, { force: true }).catch(() => undefined);
      await rename(source, destination).catch(() => undefined);
    }
    size = 0;
  };

  const write = (level: LogLevel, args: unknown[]) => {
    const message = args.map(formatValue).join(' ');
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}\n`;
    if (level === 'error') onError?.(message);
    queue = queue.catch(() => undefined).then(async () => {
      await initialize();
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > maxBytes) await rotate();
      await appendFile(logFile, line, { encoding: 'utf8', mode: 0o600 });
      size += bytes;
    }).catch(() => undefined);
  };

  for (const level of ['log', 'warn', 'error'] as const) {
    console[level] = (...args: unknown[]) => {
      try {
        originals[level](...args);
      } catch {
        // Packaged GUI apps may lose stdout/stderr and throw EPIPE. File
        // logging must continue without taking down the monitoring process.
      }
      write(level, args);
    };
  }

  return {
    flush: () => queue.catch(() => undefined),
    restoreConsole: () => {
      console.log = originals.log;
      console.warn = originals.warn;
      console.error = originals.error;
    }
  };
}

function formatValue(value: unknown): string {
  const formatted = value instanceof Error
    ? value.stack || value.message
    : typeof value === 'string'
      ? value
      : inspect(value, { depth: 4, breakLength: 160, compact: true });
  return redactSensitiveText(formatted);
}
