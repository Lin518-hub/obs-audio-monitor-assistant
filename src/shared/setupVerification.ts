import type { AppSnapshot } from './types.js';

/** Verification uses the selected input even while detection is paused. */
export function verificationMeter(snapshot: Pick<AppSnapshot, 'connected' | 'inputMonitors'>, name: string, now: number) {
  const input = snapshot.inputMonitors.find(item => item.inputName === name);
  const timestamp = input?.lastMeterAt ?? 0;
  const level = input?.lastLevelDb;
  return { timestamp, level: snapshot.connected && timestamp > 0 && now >= timestamp && now - timestamp < 2000
    && typeof level === 'number' && Number.isFinite(level) ? level : null };
}
