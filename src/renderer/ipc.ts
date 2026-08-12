import type { ObsGuardApi } from '../shared/ipc';

export type { ObsGuardApi } from '../shared/ipc';

declare global {
  interface Window {
    obsGuard: ObsGuardApi;
  }
}
