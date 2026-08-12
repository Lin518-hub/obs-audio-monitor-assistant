import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { AUDIO_ALERT_SECONDS, CAMERA_ALERT_SECONDS } from '../src/shared/reminderTiming.js';

function serverConstant(source: string, name: string): number {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  if (!match) throw new Error(`Remote server constant ${name} was not found`);
  const value = runInNewContext(`Number(${match[1]})`, Object.create(null)) as unknown;
  if (!Number.isFinite(value)) throw new Error(`Remote server constant ${name} is not numeric`);
  return Number(value);
}

describe('desktop and remote reminder contract', () => {
  it('keeps audio and camera notification defaults synchronized', () => {
    const serverSource = readFileSync(new URL('../remote-server/src/server.mjs', import.meta.url), 'utf8');
    expect(serverConstant(serverSource, 'AUDIO_ALERT_SECONDS')).toBe(AUDIO_ALERT_SECONDS);
    expect(serverConstant(serverSource, 'CAMERA_ALERT_SECONDS')).toBe(CAMERA_ALERT_SECONDS);
  });
});
