import React, { useEffect, useState } from 'react';
import { Mic2, Moon, Settings, Sun } from 'lucide-react';
import type { AppSnapshot } from '../../shared/types';
import {
  audioStateKind, dbLevelPercent, displayStatusText, floatingEmphasis, floatingHint, floatingTone, formatDb, thresholdPercent
} from '../utils/status';

export const FloatingApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('floatingTheme') === 'light' ? 'light' : 'dark'
  );

  useEffect(() => {
    let mounted = true;
    void window.obsGuard.getSnapshot().then((next) => { if (mounted) setSnapshot(next); });
    const dispose = window.obsGuard.onSnapshot((next) => { if (mounted) setSnapshot(next); });
    return () => { mounted = false; dispose(); };
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem('floatingTheme', next);
      return next;
    });
  };

  if (!snapshot) return null;

  const tone = floatingTone(snapshot);
  const isAudioNormal = audioStateKind(snapshot) === 'normal';
  const emphasis = floatingEmphasis(snapshot);
  const levelPercent = dbLevelPercent(snapshot.lastLevelDb);
  const thresholdPct = thresholdPercent(snapshot.config.silenceThresholdDb);

  return (
    <main className={`floating-shell tone-${tone} theme-${theme} ${emphasis}`}>
      <div className="floating-ambient" />
      <header className="floating-header">
        <div className="floating-status">
          <span />
          <strong>{displayStatusText(snapshot)}</strong>
        </div>
        <div className="floating-window-actions">
          <button aria-label={theme === 'dark' ? '切换浅色小浮窗' : '切换深色小浮窗'} onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button aria-label="打开设置" onClick={() => void window.obsGuard.showSettings()}>
            <Settings size={14} />
          </button>
          <button aria-label="关闭小浮窗" onClick={() => void window.obsGuard.setFloatingWindowVisible(false)}>
            ×
          </button>
        </div>
      </header>

      <section className="floating-time">
        <span>{isAudioNormal ? '检测中' : displayStatusText(snapshot)}</span>
        <strong>{isAudioNormal ? '正在讲话' : `${snapshot.silentForSeconds}s`}</strong>
        <em>{floatingHint(snapshot)}</em>
      </section>

      <section className="floating-meter">
        <div>
          <span><Mic2 size={12} />{snapshot.config.targetInputName || '未选择音源'}</span>
          <strong>{formatDb(snapshot.lastLevelDb)}</strong>
        </div>
        <div className="floating-meter-track">
          <div style={{ width: `${levelPercent}%` }} />
          <div className="floating-meter-threshold" style={{ left: `${thresholdPct}%` }} />
        </div>
      </section>
    </main>
  );
};
