const VISUAL_ONLY_INPUT_KIND_PATTERNS = [
  'image',
  'slideshow',
  'text',
  'color_source',
  'scene',
  'group',
  'monitor_capture',
  'display_capture',
  'screen_capture',
  'window_capture',
  'game_capture'
];

export function isProbablyAudibleInputKind(inputKind: string): boolean {
  const normalized = inputKind.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return !VISUAL_ONLY_INPUT_KIND_PATTERNS.some((pattern) => normalized.includes(pattern));
}
