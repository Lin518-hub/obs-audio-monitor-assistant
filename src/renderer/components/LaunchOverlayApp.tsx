import React, { useEffect, useState } from 'react';
import { LaunchProgressDialog, type LaunchProgressState } from './LaunchProgressDialog';
export function LaunchOverlayApp() {
  const [state, setState] = useState<LaunchProgressState>({ percent: 0, message: '正在准备直播工作台', steps: [], finished: false, failed: false });
  useEffect(() => {
    const apply = (next: { message: string; percent: number; startedAt?: number }) => setState(current => ({ ...current, ...next, steps: current.steps.at(-1) === next.message ? current.steps : [...current.steps, next.message].slice(-4) }));
    const dispose = window.obsGuard.onPreflightProgress(apply);
    void window.obsGuard.getPreflightOverlayState().then(apply);
    return dispose;
  }, []);
  return <LaunchProgressDialog state={state} desktop onClose={() => void window.obsGuard.releasePreflightControl()} />;
}
