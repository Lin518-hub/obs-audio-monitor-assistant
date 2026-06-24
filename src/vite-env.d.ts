/// <reference types="vite/client" />

import type {
  AlertAction,
  AlertHistoryEntry,
  AppConfig,
  AppSnapshot,
  DisplayInfo,
  InputOption,
  TestConnectionResult
} from './shared/types';

declare global {
  interface Window {
    obsGuard: {
      getSnapshot: () => Promise<AppSnapshot>;
      saveConfig: (patch: Partial<AppConfig>) => Promise<AppSnapshot>;
      refreshInputs: () => Promise<InputOption[]>;
      reconnect: () => Promise<AppSnapshot>;
      testConnection: (patch: Partial<AppConfig>) => Promise<TestConnectionResult>;
      setPaused: (paused: boolean) => Promise<AppSnapshot>;
      setSimulatedLive: (enabled: boolean) => Promise<AppSnapshot>;
      testAlert: () => Promise<AppSnapshot>;
      alertAction: (action: AlertAction) => Promise<AppSnapshot>;
      forceCloseAlert: () => Promise<AppSnapshot>;
      dismissPreAlert: () => Promise<AppSnapshot>;
      setFloatingWindowVisible: (visible: boolean) => Promise<AppSnapshot>;
      showSettings: () => Promise<void>;
      listHistory: () => Promise<AlertHistoryEntry[]>;
      clearHistory: () => Promise<AlertHistoryEntry[]>;
      updateAlertPosition: (displayId: number, position: { x: number; y: number }) => Promise<void>;
      getDisplays: () => Promise<DisplayInfo[]>;
      onSnapshot: (callback: (snapshot: AppSnapshot) => void) => () => void;
    };
  }
}
