import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BellOff, Check } from 'lucide-react';
import type { AlertAction, AppSnapshot } from '../../shared/types';

export const AlertApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [closingAction, setClosingAction] = useState<AlertAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.obsGuard.getSnapshot().then((next) => { if (mounted) setSnapshot(next); });
    const dispose = window.obsGuard.onSnapshot((next) => { if (mounted) setSnapshot(next); });
    return () => { mounted = false; dispose(); };
  }, []);

  const sendAction = useCallback(
    async (action: AlertAction) => {
      if (closingAction) return;
      setClosingAction(action);
      setError(null);
      try {
        await window.obsGuard.alertAction(action);
      } catch (err) {
        setError('关闭失败,正在尝试强制关闭。');
        try {
          await window.obsGuard.forceCloseAlert();
        } catch {
          setError(err instanceof Error ? err.message : '关闭失败,请从托盘退出后重开。');
          setClosingAction(null);
        }
      }
    },
    [closingAction]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        void sendAction('acknowledge');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sendAction]);

  if (!snapshot) return null;

  return (
    <main className="alert-shell">
      <div className="alert-icon"><AlertTriangle size={32} /></div>
      <section className="alert-copy">
        <div className="alert-kicker">音频静音提醒</div>
        <h1>{snapshot.config.targetInputName || '目标音源'} 可能没有声音</h1>
        <p>已连续静音 {snapshot.silentForSeconds} 秒,请确认麦克风是否静音、无线麦是否没电、声卡或 OBS 音频路由是否异常。</p>
      </section>
      <section className="alert-actions">
        <button className="alert-btn alert-btn-quiet" onClick={() => void sendAction('ignore_once')} disabled={closingAction !== null}>
          <BellOff size={18} />
          {closingAction === 'ignore_once' ? '处理中…' : '单次忽略'}
        </button>
        <button className="alert-btn alert-btn-confirm" onClick={() => void sendAction('acknowledge')} disabled={closingAction !== null}>
          <Check size={18} />
          {closingAction === 'acknowledge' ? '关闭中…' : '确定'}
        </button>
      </section>
      {error && <div className="alert-error">{error}</div>}
    </main>
  );
};
