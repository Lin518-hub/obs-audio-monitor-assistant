import React, { useEffect, useState } from 'react';
import { Activity, Mic2, Moon, Settings, Sun, Video } from 'lucide-react';
import type { AppSnapshot } from '../../shared/types';
import {
  audioStateKind, dbLevelPercent, displayStatusText, floatingEmphasis, floatingHint, floatingTone, formatDb, thresholdPercent
} from '../utils/status';

const FLOATING_BASE_WIDTH = 340;
const FLOATING_BASE_HEIGHT = 178;

export const FloatingApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('floatingTheme') === 'light' ? 'light' : 'dark'
  );
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let mounted = true;
    void window.obsGuard.getSnapshot().then((next) => { if (mounted) setSnapshot(next); });
    const dispose = window.obsGuard.onSnapshot((next) => { if (mounted) setSnapshot(next); });
    return () => { mounted = false; dispose(); };
  }, []);

  useEffect(() => {
    const updateScale = () => {
      const next = Math.min(window.innerWidth / FLOATING_BASE_WIDTH, window.innerHeight / FLOATING_BASE_HEIGHT);
      setScale(Number.isFinite(next) ? Math.max(0.72, next) : 1);
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
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
  const scaleStyle = { '--floating-ui-scale': String(scale) } as React.CSSProperties;
  const modules = snapshot.config.floatingWindowModules;
  const showAudioModule = modules.audio || (!modules.atem && !modules.obsStats);
  const showExtraModules = modules.atem || modules.obsStats;
  const inputName = snapshot.activeInputName || snapshot.config.targetInputName || '未选择音源';

  return (
    <main className="floating-stage" style={scaleStyle}>
      <section className={`floating-shell tone-${tone} theme-${theme} ${emphasis}`}>
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

        {showAudioModule && (
          <>
            <section className="floating-time">
              <span>{isAudioNormal ? '检测中' : displayStatusText(snapshot)}</span>
              <strong>{isAudioNormal ? '正在讲话' : `${snapshot.silentForSeconds}s`}</strong>
              <em>{floatingHint(snapshot)}</em>
            </section>

            <section className="floating-meter">
              <div>
                <span><Mic2 size={12} />{inputName}</span>
                <strong>{formatDb(snapshot.lastLevelDb)}</strong>
              </div>
              <div className="floating-meter-track">
                <div style={{ width: `${levelPercent}%` }} />
                <div className="floating-meter-threshold" style={{ left: `${thresholdPct}%` }} />
              </div>
            </section>
          </>
        )}

        {showExtraModules && (
          <section className="floating-modules">
            {modules.atem && (
              <div className={`floating-module ${snapshot.atemProgramInputOverLimit ? 'warn' : ''}`}>
                <Video size={12} />
                <span>PGM {snapshot.atemProgramInput || '--'}</span>
                <strong>{snapshot.atemProgramInputElapsedSeconds}s</strong>
              </div>
            )}
            {modules.obsStats && (
              <div className="floating-module">
                <Activity size={12} />
                <span>{snapshot.obsStats.activeFps ? `${snapshot.obsStats.activeFps.toFixed(0)} FPS` : 'OBS'}</span>
                <strong>{snapshot.obsStats.cpuUsage !== null ? `${snapshot.obsStats.cpuUsage.toFixed(0)}%` : '--'}</strong>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
};
