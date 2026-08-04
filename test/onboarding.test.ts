import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/shared/types.js';
import { shouldShowOnboarding, shouldShowReleaseNotes } from '../src/renderer/utils/status.js';

describe('onboarding visibility', () => {
  it('does not reopen after an ordinary version update', () => {
    expect(shouldShowOnboarding({
      ...DEFAULT_CONFIG,
      hasSeenGuide: true,
      guideSeenVersion: '3.5.0'
    }, '3.7.0')).toBe(false);
  });

  it('opens for a first install or after factory reset', () => {
    expect(shouldShowOnboarding({ ...DEFAULT_CONFIG, hasSeenGuide: false }, '3.7.0')).toBe(true);
  });

  it('shows client release notes once after an update', () => {
    expect(shouldShowReleaseNotes({
      ...DEFAULT_CONFIG,
      hasSeenGuide: true,
      releaseNotesSeenVersion: '3.9.4'
    }, '3.9.6')).toBe(true);

    expect(shouldShowReleaseNotes({
      ...DEFAULT_CONFIG,
      hasSeenGuide: true,
      releaseNotesSeenVersion: '3.9.6'
    }, '3.9.6')).toBe(false);
  });

  it('does not place release notes over the first-run guide', () => {
    expect(shouldShowReleaseNotes({
      ...DEFAULT_CONFIG,
      hasSeenGuide: false,
      releaseNotesSeenVersion: ''
    }, '3.9.6')).toBe(false);
  });
});
