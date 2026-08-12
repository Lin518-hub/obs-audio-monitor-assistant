import type { AppSnapshot } from '../shared/types.js';

export function rendererSnapshot(snapshot: AppSnapshot, includeVolumeHistory = true): AppSnapshot {
  return {
    ...snapshot,
    config: {
      ...snapshot.config,
      remoteDeviceSecret: ''
    },
    volumeHistory: includeVolumeHistory ? snapshot.volumeHistory : []
  };
}
