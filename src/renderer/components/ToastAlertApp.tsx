import React, { useCallback, useEffect, useState } from 'react';
import { Mic2, X } from 'lucide-react';
import type { AppSnapshot } from '../../shared/types';

export function playAlertTone(enabled: boolean): void {
  if (!enabled) {
    return;
  }

  try {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    const context = new AudioContextCtor();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.46);
    window.setTimeout(() => void context.close().catch(() => undefined), 700);
  } catch {
    // Browsers may block audio in rare cases; the visual alert still works.
  }
}

export const ToastAlertApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.obsGuard.getSnapshot().then((next) => {
      if (mounted) {
        setSnapshot(next);
        playAlertTone(next.config.alertSoundEnabled);
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

  return (
    <main className="toast-alert-shell">
      <header className="toast-alert-titlebar">
        <strong>提示</strong>
        <button type="button" aria-label="关闭" onClick={close}><X size={16} /></button>
      </header>
      <section className="toast-alert-body">
        <span className="toast-alert-icon"><Mic2 size={30} /></span>
        <div className="toast-alert-copy">
          <strong>检测到{inputName}没有声音</strong>
          <em>已连续静音 {snapshot.silentForSeconds} 秒</em>
        </div>
        <button type="button" className="toast-alert-confirm" onClick={close}>确定</button>
      </section>
    </main>
  );
};
