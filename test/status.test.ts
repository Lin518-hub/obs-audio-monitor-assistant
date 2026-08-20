import { describe, expect, it } from 'vitest';
import { shouldFlashAudioRecovery, type AudioRecoveryState } from '../src/renderer/utils/status.js';

const state = (patch: Partial<AudioRecoveryState>): AudioRecoveryState => ({
  monitoringActive: true,
  kind: 'normal',
  silentForSeconds: 0,
  ...patch
});

describe('floating audio recovery feedback', () => {
  it('flashes once after confirmed silence returns to speaking', () => {
    expect(shouldFlashAudioRecovery(
      state({ kind: 'silent', silentForSeconds: 3 }),
      state({ kind: 'normal' })
    )).toBe(true);
  });

  it('does not flash for short breaths, first render, reconnects or manual starts', () => {
    expect(shouldFlashAudioRecovery(
      state({ kind: 'silent', silentForSeconds: 2 }),
      state({ kind: 'normal' })
    )).toBe(false);
    expect(shouldFlashAudioRecovery(null, state({ kind: 'normal' }))).toBe(false);
    expect(shouldFlashAudioRecovery(
      state({ monitoringActive: false, kind: 'other' }),
      state({ kind: 'normal' })
    )).toBe(false);
    expect(shouldFlashAudioRecovery(
      state({ kind: 'other' }),
      state({ kind: 'normal' })
    )).toBe(false);
  });
});
