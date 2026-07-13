import { useEffect, useState } from 'react';
import type { AppSnapshot } from '../../shared/types';

/**
 * 订阅主进程推送的 AppSnapshot,初始值通过 getSnapshot 拉取。
 * 返回 unsubscribe 已在内部处理。
 */
export const useSnapshot = (): AppSnapshot | null => {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);

  const mergeSnapshot = (next: AppSnapshot, current: AppSnapshot | null): AppSnapshot => {
    if (next.volumeHistory.length > 0 || !current || current.volumeHistory.length === 0) {
      return next;
    }
    return { ...next, volumeHistory: current.volumeHistory };
  };

  useEffect(() => {
    let mounted = true;

    void window.obsGuard.getSnapshot().then((next) => {
      if (mounted) {
        setSnapshot((current) => mergeSnapshot(next, current));
      }
    });

    const dispose = window.obsGuard.onSnapshot((next) => {
      if (mounted) {
        setSnapshot((current) => mergeSnapshot(next, current));
      }
    });

    return () => {
      mounted = false;
      dispose();
    };
  }, []);

  return snapshot;
};
