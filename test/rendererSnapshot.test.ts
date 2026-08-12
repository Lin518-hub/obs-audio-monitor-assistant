import { describe, expect, it } from 'vitest';
import { rendererSnapshot } from '../src/main/rendererSnapshot.js';
import type { AppSnapshot } from '../src/shared/types.js';

describe('renderer snapshots', () => {
  const snapshot = {
    config: { remoteDeviceSecret: 'private-secret' },
    volumeHistory: [{ timestamp: 1, inputName: '麦克风/Aux', levelDb: -20 }]
  } as AppSnapshot;

  it('always removes the remote device secret', () => {
    const result = rendererSnapshot(snapshot);
    expect(result.config.remoteDeviceSecret).toBe('');
    expect(snapshot.config.remoteDeviceSecret).toBe('private-secret');
  });

  it('keeps history for the settings window and omits it for compact surfaces', () => {
    expect(rendererSnapshot(snapshot, true).volumeHistory).toHaveLength(1);
    expect(rendererSnapshot(snapshot, false).volumeHistory).toEqual([]);
    expect(snapshot.volumeHistory).toHaveLength(1);
  });
});
