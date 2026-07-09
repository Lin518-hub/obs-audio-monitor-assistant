import React, { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { AppSnapshot } from '../../shared/types';

export const PreAlertApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    let mounted = true;
    void window.obsGuard.getSnapshot().then((next) => { if (mounted) setSnapshot(next); });
    const dispose = window.obsGuard.onSnapshot((next) => { if (mounted) setSnapshot(next); });
    return () => { mounted = false; dispose(); };
  }, []);

  if (!snapshot) return null;

  return (
    <main className="prealert-shell">
      <button
        className="prealert-close"
        aria-label="关闭本次预警"
        disabled={dismissing}
        onClick={() => {
          setDismissing(true);
          void window.obsGuard.dismissPreAlert().catch(() => setDismissing(false));
        }}
      >×</button>
      <div className="prealert-icon"><Clock3 size={24} /></div>
      <section>
        <div className="prealert-kicker">静音预警</div>
        <strong>{snapshot.activeInputName || snapshot.config.targetInputName || '目标音源'} 已静音 {snapshot.silentForSeconds} 秒</strong>
        <p>约 {snapshot.preAlertRemainingSeconds ?? 0} 秒后触发正式报警</p>
      </section>
    </main>
  );
};
