import React, { useRef, useState } from 'react';
import { Activity, Mic2 } from 'lucide-react';
import type { AppConfig, AppSnapshot } from '../../shared/types';
import { audioStateKind, dbLevelPercent, displayedSilenceSeconds, formatDb, secondsUntilVisibleAlert, snapshotTargetName, thresholdPercent } from '../utils/status';

interface LevelMeterProps {
  snapshot: AppSnapshot;
  draft: AppConfig;
  onChangeThreshold: (value: number) => void;
}

const MIN_DB = -90;
const MAX_DB = -5;

export const LevelMeter: React.FC<LevelMeterProps> = ({ snapshot, draft, onChangeThreshold }) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const level = dbLevelPercent(snapshot.lastLevelDb);
  const threshold = thresholdPercent(draft.silenceThresholdDb);
  const state = audioStateKind(snapshot);
  const silent = displayedSilenceSeconds(snapshot);
  const remaining = secondsUntilVisibleAlert(snapshot);
  const targetName = snapshotTargetName(snapshot);

  const applyClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChangeThreshold(Math.round(pct * (MAX_DB - MIN_DB) + MIN_DB));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
      pointerIdRef.current = event.pointerId;
    } catch {
      pointerIdRef.current = null;
    }
    setDragging(true);
    applyClientX(event.clientX);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    applyClientX(event.clientX);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    const captured = pointerIdRef.current;
    if (captured !== null) {
      try { event.currentTarget.releasePointerCapture(captured); } catch { /* ignore */ }
      pointerIdRef.current = null;
    }
  };

  return (
    <section className="level-meter" data-guide="meter">
      <header className="level-meter-header">
        <h2>
          实时电平
          <em>{targetName}</em>
        </h2>
        <div className={`level-meter-state state-${state}`}>
          <Activity size={14} />
          {state === 'normal' ? '正在讲话' : state === 'silent' ? `${silent}s 静音` : '未在检测'}
        </div>
      </header>

      <div className="level-meter-figure">
        <span className="level-meter-source">
          <Mic2 size={14} />
          {targetName}
        </span>
        <strong className={`level-meter-value level-${state}`}>{formatDb(snapshot.lastLevelDb)}</strong>
      </div>

      <div
        className={`level-meter-track ${dragging ? 'dragging' : ''}`}
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="slider"
        aria-label="实时电平与静音阈值"
        aria-valuemin={MIN_DB}
        aria-valuemax={MAX_DB}
        aria-valuenow={Math.round(draft.silenceThresholdDb)}
      >
        <div className="level-meter-fill" style={{ width: `${level}%` }} />
        <div className="level-meter-threshold" style={{ left: `${threshold}%` }}>
          <div className="level-meter-threshold-line" />
          <div className="level-meter-threshold-label">{Math.round(draft.silenceThresholdDb)} dB</div>
        </div>
      </div>

      <footer className="level-meter-footer">
        <div className="level-meter-scale">
          <span>-90</span>
          <span>-70</span>
          <span>-50</span>
          <span>-30</span>
          <span>-10</span>
        </div>
        <div className="level-meter-remaining">
          {state === 'silent' ? (
            <>
              <span>距报警</span>
              <strong>{remaining}s</strong>
            </>
          ) : state === 'normal' ? (
            <span className="level-meter-remaining-ok">音频正常</span>
          ) : (
            <span className="level-meter-remaining-wait">等待直播 / 录制</span>
          )}
        </div>
      </footer>
    </section>
  );
};
