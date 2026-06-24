import { screen } from 'electron';
import type { DisplayInfo } from '../shared/types.js';

export function getDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;

  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: display.id === primaryId ? `主屏幕 (${index + 1})` : `屏幕 ${index + 1}`,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    },
    primary: display.id === primaryId
  }));
}
