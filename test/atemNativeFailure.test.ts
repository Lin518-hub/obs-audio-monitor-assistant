import { expect, it, vi } from 'vitest';
vi.mock('atem-connection', () => { throw new Error('Native module unavailable'); });
import { ATEMMonitor } from '../src/main/ATEMMonitor';
it('keeps the app usable when the optional ATEM native module cannot load', async () => {
  const monitor = new ATEMMonitor();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(monitor.setConfig(false, '')).resolves.toMatchObject({connected: false});
    await expect(monitor.setConfig(true, '192.168.1.240')).resolves.toMatchObject({connected: false, connectionState: 'error', errorMessage: expect.stringContaining('OBS 音频检测可继续使用')});
  } finally { await monitor.stop(); log.mockRestore(); }
});
