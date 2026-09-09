import { describe, expect, it } from 'vitest';
import { shouldFlashAudioSilence, shouldFlashAudioRecovery, type AudioRecoveryState } from '../src/renderer/utils/status.js';

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


describe('floating silence feedback', () => {
  it('flashes once at three seconds and does not repeat during continuing silence', () => {
    expect(shouldFlashAudioSilence(state({ kind: 'confirming' }), state({ kind: 'silent', silentForSeconds: 3 }))).toBe(true);
    expect(shouldFlashAudioSilence(state({ kind: 'silent', silentForSeconds: 3 }), state({ kind: 'silent', silentForSeconds: 4 }))).toBe(false);
    expect(shouldFlashAudioSilence(state({}), state({ kind: 'confirming', silentForSeconds: 2 }))).toBe(false);
  });
  it('does not flash on initial render, reconnect or stopped detection', () => {
    const silent = state({ kind: 'silent', silentForSeconds: 3 });
    expect(shouldFlashAudioSilence(null, silent)).toBe(false);
    expect(shouldFlashAudioSilence(state({ kind: 'other' }), silent)).toBe(false);
    expect(shouldFlashAudioSilence(state({ monitoringActive: false }), silent)).toBe(false);
    expect(shouldFlashAudioSilence(state({}), { ...silent, monitoringActive: false })).toBe(false);
  });
});
