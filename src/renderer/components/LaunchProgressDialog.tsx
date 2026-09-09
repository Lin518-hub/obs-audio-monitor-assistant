import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, AlertTriangle, Sparkles } from 'lucide-react';

export interface LaunchProgressState {
  percent: number;
  message: string;
  steps: string[];
  finished: boolean;
  failed: boolean;
}

export const LaunchProgressDialog: React.FC<{ state: LaunchProgressState; onClose: () => void }> = ({ state, onClose }) => {
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
    <div className="launch-progress-overlay" role="dialog" aria-modal="true" aria-labelledby="launch-progress-title"
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus(); }
      }}>
      <section className={`launch-progress-card ${state.finished ? 'finished' : ''} ${state.failed ? 'failed' : ''}`}>
        <div className="launch-progress-orbit" aria-hidden="true"><i /><i /><span>{state.finished ? state.failed ? <AlertTriangle size={30} /> : <Check size={30} /> : <Sparkles size={30} />}</span></div>
        <span className="launch-progress-eyebrow">直播工作站 · 启动准备</span>
        <h2 id="launch-progress-title">{state.finished ? state.failed ? '部分步骤需要处理' : '一切准备就绪' : '正在准备你的直播工作台'}</h2>
        <p className="launch-progress-message" role="status" aria-live="polite" key={state.message}>{state.message}</p>
        <div className="launch-progress-track" role="progressbar" aria-label="启动步骤进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent}>
          <span style={{ width: `${state.percent}%` }} />
        </div>
        <div className="launch-progress-caption"><span>{state.finished ? '启动流程已结束' : '按实际步骤推进'}</span><strong>{state.percent}%</strong></div>
        {!state.finished && <ol className="launch-progress-steps" aria-hidden="true">{state.steps.map((step,index) => <li key={step}><span>{index === state.steps.length - 1 ? '·' : '○'}</span>{step}</li>)}</ol>}
        <button ref={closeRef} type="button" className="btn-secondary" onClick={onClose}>{state.finished ? '知道了' : '收起，后台继续'}</button>
      </section>
    </div>, document.body
  );
};
