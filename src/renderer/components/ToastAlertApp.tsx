import React, { useCallback, useEffect, useState } from 'react';
import { Mic2, Video, X } from 'lucide-react';
import type { AppSnapshot } from '../../shared/types';

export const ToastAlertApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.obsGuard.getSnapshot().then((next) => {
      if (mounted) {
        setSnapshot(next);
      }
    });
    const dispose = window.obsGuard.onSnapshot((next) => { if (mounted) setSnapshot(next); });
    return () => { mounted = false; dispose(); };
  }, []);

  const close = useCallback(() => {
    void window.obsGuard.alertAction('acknowledge');
  }, []);

  if (!snapshot) {
    return null;
  }

  const inputName = snapshot.activeInputName || snapshot.config.targetInputName || '麦克风';
  const isCameraAlert = snapshot.activeAlertSource === 'atem_camera';
  const cameraLabel = snapshot.atemInputLabels[snapshot.atemProgramInput] || `PGM ${snapshot.atemProgramInput || '--'}`;

  return (
    <main className="toast-alert-shell">
      <header className="toast-alert-titlebar">
        <strong>提示</strong>
        <button type="button" aria-label="关闭" onClick={close}><X size={16} /></button>
      </header>
      <section className="toast-alert-body">
        <span className="toast-alert-icon">{isCameraAlert ? <Video size={30} /> : <Mic2 size={30} />}</span>
        <div className="toast-alert-copy">
          <strong>{isCameraAlert ? `${cameraLabel} 长时间未切换` : `检测到${inputName}没有声音`}</strong>
          <em>{isCameraAlert ? `已连续使用 ${snapshot.atemProgramInputElapsedSeconds} 秒` : `已连续静音 ${snapshot.silentForSeconds} 秒`}</em>
        </div>
        <button type="button" className="toast-alert-confirm" onClick={close}>确定</button>
      </section>
    </main>
  );
};
