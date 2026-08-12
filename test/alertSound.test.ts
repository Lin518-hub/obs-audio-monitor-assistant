import { afterEach, describe, expect, it } from 'vitest';
import { playAlertTone } from '../src/renderer/utils/alertSound.js';

class FakeAudioContext {
  static instances = 0;
  state = 'running';
  currentTime = 0;
  destination = {};

  constructor() {
    FakeAudioContext.instances += 1;
  }

  createGain() {
    return {
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
      disconnect() {}
    };
  }

  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime() {} },
      connect() {},
      disconnect() {},
      start() {},
      stop() {},
      addEventListener(_event: string, listener: () => void) { listener(); }
    };
  }

  resume() { return Promise.resolve(); }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  FakeAudioContext.instances = 0;
});

describe('alert sound', () => {
  it('reuses one audio context across repeated warning tones', () => {
    (globalThis as { window?: unknown }).window = { AudioContext: FakeAudioContext };
    playAlertTone(true, 'strong');
    playAlertTone(true, 'clear');
    expect(FakeAudioContext.instances).toBe(1);
  });
});
