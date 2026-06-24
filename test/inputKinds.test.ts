import { describe, expect, it } from 'vitest';
import { isProbablyAudibleInputKind } from '../src/shared/inputKinds.js';

describe('isProbablyAudibleInputKind', () => {
  it('filters common visual-only OBS inputs', () => {
    expect(isProbablyAudibleInputKind('image_source')).toBe(false);
    expect(isProbablyAudibleInputKind('text_gdiplus')).toBe(false);
    expect(isProbablyAudibleInputKind('monitor_capture')).toBe(false);
    expect(isProbablyAudibleInputKind('game_capture')).toBe(false);
  });

  it('keeps audio-capable and unknown plugin inputs', () => {
    expect(isProbablyAudibleInputKind('wasapi_input_capture')).toBe(true);
    expect(isProbablyAudibleInputKind('dshow_input')).toBe(true);
    expect(isProbablyAudibleInputKind('ffmpeg_source')).toBe(true);
    expect(isProbablyAudibleInputKind('custom_livestream_audio_source')).toBe(true);
  });
});
