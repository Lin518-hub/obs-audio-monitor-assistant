import { describe, expect, it } from 'vitest';
import {
  AUDIO_ALERT_SECONDS,
  CAMERA_ALERT_SECONDS,
  CAMERA_DESKTOP_ALERT_SECONDS,
  reminderVisualState
} from '../src/shared/reminderTiming.js';

describe('shared reminder timing', () => {
  it('keeps audio, camera status and desktop camera alert thresholds aligned', () => {
    expect(AUDIO_ALERT_SECONDS).toBe(120);
    expect(CAMERA_ALERT_SECONDS).toBe(600);
    expect(CAMERA_DESKTOP_ALERT_SECONDS).toBe(720);
  });

  it('moves continuously from safe through yellow to red', () => {
    expect(reminderVisualState(30, 120)).toMatchObject({
      warningProgress: 0,
      dangerProgress: 0,
      tone: 'safe'
    });

    const warning = reminderVisualState(75, 120);
    expect(warning.warningProgress).toBeGreaterThan(0);
    expect(warning.warningProgress).toBeLessThan(1);
    expect(warning.dangerProgress).toBe(0);
    expect(warning.tone).toBe('warning');

    const danger = reminderVisualState(114, 120);
    expect(danger.warningProgress).toBe(1);
    expect(danger.dangerProgress).toBeGreaterThan(0);
    expect(danger.dangerProgress).toBeLessThan(1);
    expect(danger.tone).toBe('danger');
  });
});
