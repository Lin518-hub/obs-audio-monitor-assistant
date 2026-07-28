export const AUDIO_ALERT_SECONDS = 120;
export const CAMERA_ALERT_SECONDS = 10 * 60;
export const CAMERA_DESKTOP_ALERT_SECONDS = 12 * 60;

const WARNING_START_RATIO = 0.25;
const DANGER_START_RATIO = 0.9;

export interface ReminderVisualState {
  ratio: number;
  warningProgress: number;
  dangerProgress: number;
  tone: 'safe' | 'warning' | 'danger';
}

/**
 * Uses one visual rhythm for every countdown:
 * normal -> gradually warmer from 25% -> red near the end -> reminder.
 */
export function reminderVisualState(elapsedSeconds: number, limitSeconds: number): ReminderVisualState {
  const safeLimit = Math.max(1, limitSeconds);
  const ratio = Math.max(0, elapsedSeconds) / safeLimit;
  const warningProgress = ratio <= WARNING_START_RATIO
    ? 0
    : Math.min(1, (ratio - WARNING_START_RATIO) / (DANGER_START_RATIO - WARNING_START_RATIO));
  const dangerProgress = ratio <= DANGER_START_RATIO
    ? 0
    : Math.min(1, (ratio - DANGER_START_RATIO) / (1 - DANGER_START_RATIO));

  return {
    ratio,
    warningProgress,
    dangerProgress,
    tone: ratio >= DANGER_START_RATIO ? 'danger' : warningProgress > 0 ? 'warning' : 'safe'
  };
}
