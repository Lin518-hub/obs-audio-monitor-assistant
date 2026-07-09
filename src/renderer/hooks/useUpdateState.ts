import { useEffect, useState } from 'react';
import type { UpdateSnapshot } from '../../shared/types';

/**
 * 订阅主进程推送的 UpdateSnapshot(自动更新状态)。
 */
export const useUpdateState = (): UpdateSnapshot | null => {
  const [state, setState] = useState<UpdateSnapshot | null>(null);

  useEffect(() => {
    let mounted = true;

    void window.obsGuard.getUpdateState().then((next) => {
      if (mounted) {
        setState(next);
      }
    });

    const dispose = window.obsGuard.onUpdateState((next) => {
      if (mounted) {
        setState(next);
      }
    });

    return () => {
      mounted = false;
      dispose();
    };
  }, []);

  return state;
};
