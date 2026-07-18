import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/shared/types.js';
import { shouldShowOnboarding } from '../src/renderer/utils/status.js';

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
});
