import { describe, expect, it } from 'vitest';
import { OBSMonitor } from '../src/main/obsMonitor.js';
import { DEFAULT_CONFIG, type AppConfig, type DisplayInfo } from '../src/shared/types.js';

const config: AppConfig = {
  ...DEFAULT_CONFIG,
  targetInputName: 'Mic',
  silenceDurationSeconds: 120
};

const displays: DisplayInfo[] = [
  {
    id: 1,
    label: '主屏幕 (1)',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    primary: true
  }
];

describe('OBSMonitor test alert', () => {
  it('emits a test alert and restores the previous snapshot after action', async () => {
    const monitor = new OBSMonitor(config, displays);
    let alerts = 0;
    monitor.on('alert', () => {
      alerts += 1;
    });

    const before = monitor.getSnapshot();
    const alertSnapshot = monitor.triggerTestAlert();

    expect(alerts).toBe(1);
    expect(alertSnapshot.alertVisible).toBe(true);
    expect(alertSnapshot.status).toBe('alerting');
    expect(alertSnapshot.config.targetInputName).toBe('Mic');

    const after = monitor.handleAlertAction('acknowledge');
    expect(after.alertVisible).toBe(before.alertVisible);
    expect(after.connected).toBe(before.connected);
    expect(after.status).toBe(before.status);

    await monitor.stop();
  });
});
