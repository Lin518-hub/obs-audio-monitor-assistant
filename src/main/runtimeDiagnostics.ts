import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RuntimeErrorSummary } from '../shared/types.js';

const MAX_MESSAGE_LENGTH = 240;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class RuntimeDiagnosticsStore {
  private latest: RuntimeErrorSummary | null;

  constructor(private readonly filePath: string) {
    this.latest = this.load();
  }

  record(code: string, source: string, message: unknown, occurredAt = Date.now()): RuntimeErrorSummary {
    const normalized = {
      code: cleanValue(code, 80) || 'unknown_error',
      source: cleanValue(source, 80) || 'main',
      message: cleanValue(message instanceof Error ? message.message : message, MAX_MESSAGE_LENGTH) || '未知错误'
    };
    const repeated = this.latest?.code === normalized.code
      && this.latest.source === normalized.source
      && this.latest.message === normalized.message;
    this.latest = {
      ...normalized,
      occurredAt,
      count: repeated ? Math.max(1, this.latest?.count ?? 0) + 1 : 1
    };
    this.persist(this.latest);
    return { ...this.latest };
  }

  getRecent(maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now()): RuntimeErrorSummary | null {
    if (!this.latest || now - this.latest.occurredAt > maxAgeMs) return null;
    return { ...this.latest };
  }

  private load(): RuntimeErrorSummary | null {
    try {
      const value = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<RuntimeErrorSummary>;
      if (!Number.isFinite(value.occurredAt) || !Number.isFinite(value.count)) return null;
      const code = cleanValue(value.code, 80);
      const source = cleanValue(value.source, 80);
      const message = cleanValue(value.message, MAX_MESSAGE_LENGTH);
      if (!code || !source || !message) return null;
      return {
        code,
        source,
        message,
        occurredAt: Number(value.occurredAt),
        count: Math.max(1, Math.floor(Number(value.count)))
      };
    } catch {
      return null;
    }
  }

  private persist(value: RuntimeErrorSummary): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      renameSync(temporary, this.filePath);
    } catch {
      // Diagnostics must never become another failure source.
    }
  }
}

function cleanValue(value: unknown, maxLength: number): string {
  return redactSensitiveText(String(value ?? ''))
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:key|token|secret|password|access_token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:password|secret|token|webhook|api[_-]?key)\s*["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi, '$1[REDACTED]');
}
