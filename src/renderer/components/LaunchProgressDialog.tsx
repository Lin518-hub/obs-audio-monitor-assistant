import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, AlertTriangle, Sparkles } from 'lucide-react';

export interface LaunchProgressState {
  startedAt?: number;
  percent: number;
  message: string;
  steps: string[];
  finished: boolean;
  failed: boolean;
}

export const LaunchProgressDialog: React.FC<{ state: LaunchProgressState; onClose: () => void; onRetry?: () => void; desktop?: boolean }> = ({ state, onClose, onRetry, desktop = false }) => {
  const startRef = useRef(state.startedAt ?? Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (state.finished) return;
    const tick = () => setElapsed(Math.floor((Date.now() - (state.startedAt ?? startRef.current)) / 1000));
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [state.finished, state.startedAt]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (!state.finished || state.failed) return;
    const timer = window.setTimeout(() => onCloseRef.current(), 2200);
    return () => window.clearTimeout(timer);
  }, [state.finished, state.failed]);
  return createPortal(
    <div className={`launch-progress-overlay ${desktop ? "desktop-launch-cover" : ""}`} role="dialog" aria-modal="true" aria-labelledby="launch-progress-title"
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          event.preventDefault(); buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
        }
      }}>
      {desktop && <div className="launch-cover-emphasis" aria-hidden="true"><span className="alert-backdrop-edge top" /><span className="alert-backdrop-edge right" /><span className="alert-backdrop-edge bottom" /><span className="alert-backdrop-edge left" /><span className="alert-backdrop-outline" /></div>}
      <section className={`launch-progress-card ${state.finished ? 'finished' : ''} ${state.failed ? 'failed' : ''}`}>
        <div className="launch-progress-orbit" aria-hidden="true"><i /><i /><span>{state.finished ? state.failed ? <AlertTriangle size={30} /> : <Check size={30} /> : <Sparkles size={30} />}</span></div>
        <span className="launch-progress-eyebrow">直播工作站 · 启动准备</span>
        <h2 id="launch-progress-title">{state.finished ? state.failed ? '部分步骤需要处理' : '一切准备就绪' : '正在准备你的直播工作台'}</h2>
        <p className="launch-progress-message" role="status" aria-live="polite" key={state.message}>{state.message}</p>
        <div className="launch-progress-track" role="progressbar" aria-label="启动步骤进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent}>
          <span style={{ width: `${state.percent}%` }} />
        </div>
        <div className="launch-progress-caption"><span>{state.finished ? '启动流程已结束' : `已用时 ${elapsed} 秒 · 正在等待此步骤完成`}</span><strong>{state.percent}%</strong></div>
        {!state.finished && <ol className="launch-progress-steps" aria-hidden="true">{state.steps.map((step,index) => <li key={step}><span>{index === state.steps.length - 1 ? '·' : '○'}</span>{step}</li>)}</ol>}
        {state.finished && state.failed && onRetry && <button type="button" className="btn-primary" onClick={onRetry}>仅重试失败步骤</button>}
        <button ref={closeRef} type="button" className="btn-secondary" onClick={onClose}>{state.finished ? '知道了' : '交回操作权，停止后续自动操作'}</button>
      </section>
    </div>, document.body
  );
};
