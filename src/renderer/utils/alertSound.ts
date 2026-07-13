import type { AlertSoundPreset } from '../../shared/types';

const SOUND_PRESETS: Record<AlertSoundPreset, { frequency: number; gain: number; duration: number; type: OscillatorType }> = {
  clear: { frequency: 880, gain: 0.34, duration: 0.46, type: 'sine' },
  strong: { frequency: 660, gain: 0.42, duration: 0.56, type: 'triangle' },
  low: { frequency: 440, gain: 0.30, duration: 0.48, type: 'square' },
  soft: { frequency: 740, gain: 0.28, duration: 0.40, type: 'sine' }
};

/** Play one audible cue through the system default output. */
export function playAlertTone(enabled: boolean, preset: AlertSoundPreset = 'strong'): void {
  if (!enabled) {
    return;
  }

  try {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    const context = new AudioContextCtor();
    const tone = SOUND_PRESETS[preset] ?? SOUND_PRESETS.strong;
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    const now = context.currentTime;
    const end = now + tone.duration;

    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(tone.gain, now + 0.028);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(end + 0.04);
    window.setTimeout(() => void context.close().catch(() => undefined), 700);
  } catch {
    // Browsers may block audio in rare cases; the visual alert still works.
  }
}

/** Keep the warning audible until the alert surface is dismissed. */
export function startAlertToneLoop(enabled: boolean, preset: AlertSoundPreset = 'strong'): () => void {
  if (!enabled) {
    return () => undefined;
  }

  playAlertTone(true, preset);
  const timer = window.setInterval(() => playAlertTone(true, preset), 1500);
  return () => window.clearInterval(timer);
}
