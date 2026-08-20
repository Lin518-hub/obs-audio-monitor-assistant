import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, Mic2, Moon, Settings, Sun, Video } from 'lucide-react';
import { CAMERA_ALERT_SECONDS, reminderVisualState } from '../../shared/reminderTiming';
import type { AppSnapshot } from '../../shared/types';
import { useAudioMeter } from '../hooks/useAudioMeter';
import {
  audioRecoveryState, audioStateKind, dbLevelPercent, displayStatusText, floatingEmphasis, floatingHint, floatingTone,
  floatingWarningProgress, formatDb, shouldFlashAudioRecovery, thresholdPercent, type AudioRecoveryState
} from '../utils/status';

const AUDIO_FLOATING_BASE = { width: 340, height: 178 };
const AUDIO_ATEM_FLOATING_BASE = { width: 340, height: 178 };
const MULTI_FLOATING_BASE = { width: 460, height: 300 };

export const FloatingApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('floatingTheme') === 'light' ? 'light' : 'dark'
  );
  const [recoveryFlashId, setRecoveryFlashId] = useState<number | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const previousAudioState = useRef<AudioRecoveryState | null>(null);
  const meter = useAudioMeter(snapshot);

  useEffect(() => {
    let mounted = true;
    void window.obsGuard.getSnapshot().then((next) => { if (mounted) setSnapshot(next); });
    const dispose = window.obsGuard.onSnapshot((next) => { if (mounted) setSnapshot(next); });
    return () => { mounted = false; dispose(); };
  }, []);

  const mode = snapshot?.config.floatingWindowMode ?? 'audio';
  const isMulti = mode === 'multifunction';
  const isAudioAtem = mode === 'audio_atem';

  useEffect(() => {
    if (!snapshot) return;
    const current = audioRecoveryState(snapshot);
    if (shouldFlashAudioRecovery(previousAudioState.current, current)) {
      setRecoveryFlashId((value) => (value ?? 0) + 1);
    }
    previousAudioState.current = current;
  }, [snapshot?.audioSpeaking, snapshot?.monitoringActive, snapshot?.readinessReason, snapshot?.silentForSeconds]);

  useLayoutEffect(() => {
    if (!snapshot) return;

    let frame = 0;
    const stage = stageRef.current;
    if (!stage) return;

    const updateScale = () => {
      const base = isMulti ? MULTI_FLOATING_BASE : isAudioAtem ? AUDIO_ATEM_FLOATING_BASE : AUDIO_FLOATING_BASE;
      const bounds = stage.getBoundingClientRect();
      // Fixed-ratio modes follow width only. During a native Windows resize the
      // reported height can lag by a frame, which previously caused all text to
      // jump in size before the OS completed the drag.
      const next = isMulti
        ? Math.min(bounds.width / base.width, bounds.height / base.height)
        : bounds.width / base.width;
      const scale = Number.isFinite(next) ? Math.min(2, Math.max(0.78, next)) : 1;
      stage.style.setProperty('--floating-ui-scale', String(scale));
    };
    const queueScaleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateScale);
    };

    const observer = new ResizeObserver(queueScaleUpdate);
    observer.observe(stage);
    updateScale();
    window.addEventListener('resize', queueScaleUpdate);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', queueScaleUpdate);
    };
  }, [snapshot !== null, isMulti, isAudioAtem]);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem('floatingTheme', next);
      return next;
    });
  };

  if (!snapshot) return null;

  const tone = floatingTone(snapshot);
  const emphasis = floatingEmphasis(snapshot);
  const warningProgress = floatingWarningProgress(snapshot);
  const warningGreenWeight = 1 - warningProgress;
  const warningStatusColor = interpolateRgb([34, 197, 94], [245, 158, 11], warningProgress);
  const warningTextColor = theme === 'dark'
    ? interpolateRgb([238, 243, 248], [253, 230, 138], warningProgress)
    : interpolateRgb([15, 23, 42], [146, 64, 14], warningProgress);
  const scaleStyle = {
    '--floating-warning-progress': String(warningProgress),
    '--floating-safe-layer-opacity': String(warningGreenWeight),
    '--floating-warning-layer-opacity': String(warningProgress),
    '--floating-warning-shadow-alpha': String(0.46 * warningProgress),
    '--floating-warning-glow': `${Math.round(8 + warningProgress * 40)}px`,
    '--floating-status-color': warningStatusColor,
    '--floating-warning-text': warningTextColor
  } as React.CSSProperties;
  const inputName = snapshot.activeInputName || snapshot.config.targetInputName || '未选择音源';

  const floatingTitle = mode === 'audio' ? displayStatusText(snapshot) : mode === 'audio_atem' ? '音频与机位' : '多功能监看';

  return (
    <main ref={stageRef} className="floating-stage" style={scaleStyle}>
      <section className={`floating-shell floating-${mode.replace('_', '-')}-mode tone-${tone} theme-${theme} ${emphasis}`}>
        <div className="floating-ambient" />
        {recoveryFlashId !== null && (
          <div
            key={recoveryFlashId}
            className="floating-recovery-flash"
            onAnimationEnd={() => setRecoveryFlashId(null)}
          />
        )}
        <header className="floating-header">
          <div className="floating-status">
            <span />
            <strong>{floatingTitle}</strong>
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

        {mode === 'audio' && <AudioFloatingCard snapshot={snapshot} inputName={inputName} meterLevelDb={meter.levelDb} />}
        {isAudioAtem && <AudioAtemFloatingCard snapshot={snapshot} inputName={inputName} meterLevelDb={meter.levelDb} />}
        {isMulti && <MultiFunctionGrid snapshot={snapshot} inputName={inputName} meterLevelDb={meter.levelDb} />}
      </section>
    </main>
  );
};

const AudioAtemFloatingCard: React.FC<{ snapshot: AppSnapshot; inputName: string; meterLevelDb: number | null }> = ({ snapshot, inputName, meterLevelDb }) => {
  const audioState = audioStateKind(snapshot);
  const isAudioNormal = audioState === 'normal' || audioState === 'confirming';
  const levelPercent = dbLevelPercent(meterLevelDb);
  const timerState = atemTimerState(snapshot);
  const liveActive = isLiveSession(snapshot);
  const cameraLabel = snapshot.atemInputLabels[snapshot.atemProgramInput] || '未读取机位';
  const audioPrompt = isAudioNormal
    ? { tone: 'safe', label: '音频正常' }
    : audioState === 'silent'
      ? { tone: snapshot.secondsUntilAlert !== null && snapshot.secondsUntilAlert <= 10 ? 'critical' : 'warn', label: floatingHint(snapshot) }
      : { tone: 'idle', label: floatingHint(snapshot) };
  const audioValue = isAudioNormal
    ? '正在讲话'
    : audioState === 'silent'
      ? `${snapshot.silentForSeconds}s`
      : displayStatusText(snapshot);

  return (
    <section className="floating-combo-card">
      <div className="floating-combo-metrics">
        <div className="floating-combo-audio">
          <span>音频检测</span>
          <strong>{audioValue}</strong>
          <em>{inputName}</em>
        </div>
        <div className={`floating-combo-camera ${timerState.tone}`} style={timerState.style}>
          <span>当前机位</span>
          <strong>{liveActive ? formatFloatingTime(snapshot.atemProgramInputElapsedSeconds) : '00:00'}</strong>
          <em>PGM {snapshot.atemProgramInput || '--'} · {cameraLabel}</em>
        </div>
      </div>
      <div className="floating-combo-meter">
        <div className="floating-meter-track">
          <div style={{ transform: `scaleX(${levelPercent / 100})` }} />
        </div>
      </div>
      <footer className="floating-combo-prompts">
        <div className={`floating-combo-prompt ${audioPrompt.tone}`}>
          <strong>{audioPrompt.label}</strong>
        </div>
        <div className={`floating-combo-prompt ${timerState.tone || 'safe'}`} style={timerState.style}>
          <strong>{timerState.hint}</strong>
        </div>
      </footer>
    </section>
  );
};

const AudioFloatingCard: React.FC<{ snapshot: AppSnapshot; inputName: string; meterLevelDb: number | null }> = ({ snapshot, inputName, meterLevelDb }) => {
  const audioState = audioStateKind(snapshot);
  const isAudioNormal = audioState === 'normal' || audioState === 'confirming';
  const levelPercent = dbLevelPercent(meterLevelDb);
  const thresholdPct = thresholdPercent(snapshot.config.silenceThresholdDb);

  return (
    <>
      <section className="floating-time">
        <span>{isAudioNormal ? '检测中' : displayStatusText(snapshot)}</span>
        <strong>{isAudioNormal ? '正在讲话' : `${snapshot.silentForSeconds}s`}</strong>
        <em>{floatingHint(snapshot)}</em>
      </section>
      <section className="floating-meter">
        <div>
          <span><Mic2 size={12} />{inputName}</span>
          <strong>{formatDb(meterLevelDb)}</strong>
        </div>
        <div className="floating-meter-track">
          <div style={{ transform: `scaleX(${levelPercent / 100})` }} />
          <div className="floating-meter-threshold" style={{ left: `${thresholdPct}%` }} />
        </div>
      </section>
    </>
  );
};

const MultiFunctionGrid: React.FC<{ snapshot: AppSnapshot; inputName: string; meterLevelDb: number | null }> = ({ snapshot, inputName, meterLevelDb }) => {
  const modules = snapshot.config.floatingWindowModules;
  const audioState = audioStateKind(snapshot);
  const isAudioNormal = audioState === 'normal' || audioState === 'confirming';
  const levelPercent = dbLevelPercent(meterLevelDb);
  const thresholdPct = thresholdPercent(snapshot.config.silenceThresholdDb);
  const hasModule = modules.audio || modules.atem || modules.obsStats;
  const moduleCount = Number(modules.audio) + Number(modules.atem) + Number(modules.obsStats);
  const timerState = atemTimerState(snapshot);
  const liveActive = isLiveSession(snapshot);

  return (
    <section className={`floating-multi-grid modules-${Math.max(1, moduleCount)}`}>
      {modules.audio && (
        <article className="floating-multi-card floating-multi-audio">
          <header><span><Mic2 size={13} /> 音频守护</span><strong>{isAudioNormal ? '音频正常' : '静音计时中'}</strong></header>
          <div className="floating-multi-primary-value">
            <strong>{isAudioNormal ? '正在讲话' : `${snapshot.silentForSeconds}s`}</strong>
            <b>{inputName}</b>
          </div>
          <div className="floating-meter-track">
            <div style={{ transform: `scaleX(${levelPercent / 100})` }} />
            <div className="floating-meter-threshold" style={{ left: `${thresholdPct}%` }} />
          </div>
          <footer><span>{formatDb(meterLevelDb)}</span><em>{floatingHint(snapshot)}</em></footer>
        </article>
      )}

      {modules.atem && (
        <article className={`floating-multi-card ${timerState.tone}`} style={timerState.style}>
          <header><span><Video size={13} /> ATEM 当前机位</span><strong>{timerState.label}</strong></header>
          <div className="floating-multi-primary-value">
            <strong>{liveActive ? formatFloatingTime(snapshot.atemProgramInputElapsedSeconds) : '00:00'}</strong>
            <b>PGM {snapshot.atemProgramInput || '--'} · {snapshot.atemInputLabels[snapshot.atemProgramInput] || '未读取机位'}</b>
          </div>
          <footer><span>{timerState.hint}</span><em>{snapshot.atemConnected ? '已连接' : '未连接'}</em></footer>
        </article>
      )}

      {modules.obsStats && (
        <article className="floating-multi-card">
          <header><span><Activity size={13} /> OBS 性能</span><strong>实时</strong></header>
          <div className="floating-multi-stats">
            <span><b>{snapshot.obsStats.activeFps !== null ? snapshot.obsStats.activeFps.toFixed(0) : '--'}</b> FPS</span>
            <span><b>{snapshot.obsStats.cpuUsage !== null ? snapshot.obsStats.cpuUsage.toFixed(0) : '--'}%</b> CPU</span>
            <span><b>{snapshot.obsStats.streamBitrateKbps !== null ? snapshot.obsStats.streamBitrateKbps.toFixed(0) : '--'}</b> kbps</span>
          </div>
        </article>
      )}

      {!hasModule && <div className="floating-multi-empty">请在设置中选择要显示的监看模块</div>}
    </section>
  );
};

const formatFloatingTime = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

const atemTimerState = (snapshot: AppSnapshot): {
  tone: string;
  label: string;
  hint: string;
  style?: React.CSSProperties;
} => {
  if (!snapshot.atemConnected) return { tone: '', label: '未连接', hint: '等待 ATEM 连接' };
  if (!isLiveSession(snapshot)) return { tone: '', label: '等待开播', hint: '等待直播/录制' };
  if (!snapshot.config.atemCameraTimeAlertEnabled) return { tone: '', label: '计时关闭', hint: '机位计时已关闭' };
  if (snapshot.atemProgramInputExempt) return { tone: 'safe', label: '出镜机位', hint: '已豁免计时与提醒' };
  const limit = CAMERA_ALERT_SECONDS;
  const elapsed = snapshot.atemProgramInputElapsedSeconds;
  const visual = reminderVisualState(elapsed, limit);
  const style = timerReminderStyle(visual.warningProgress, visual.dangerProgress);
  if (elapsed >= limit) {
    return { tone: 'critical', label: '机位超时', hint: `已超时 ${formatFloatingTime(elapsed - limit)}`, style };
  }
  const remaining = limit - elapsed;
  if (visual.tone === 'danger') {
    return { tone: 'critical', label: '即将超时', hint: `${formatFloatingTime(remaining)} 后提醒`, style };
  }
  if (visual.tone === 'warning') {
    return { tone: 'warn', label: '停留计时', hint: `${formatFloatingTime(remaining)} 后提醒`, style };
  }
  return { tone: '', label: '计时中', hint: `剩余 ${formatFloatingTime(remaining)}`, style };
};

const isLiveSession = (snapshot: AppSnapshot): boolean =>
  snapshot.streaming || snapshot.recording || snapshot.simulatedLive || snapshot.virtualCameraActive;

const interpolateRgb = (from: [number, number, number], to: [number, number, number], progress: number): string => {
  const amount = Math.max(0, Math.min(1, progress));
  const channels = from.map((value, index) => Math.round(value + (to[index] - value) * amount));
  return `rgb(${channels.join(', ')})`;
};

const timerReminderStyle = (warningProgress: number, dangerProgress: number): React.CSSProperties => {
  if (dangerProgress > 0) {
    return {
      backgroundColor: `rgba(127, 29, 29, ${0.08 + dangerProgress * 0.22})`,
      borderColor: `rgba(248, 113, 113, ${0.35 + dangerProgress * 0.55})`
    };
  }
  if (warningProgress > 0) {
    return {
      backgroundColor: `rgba(245, 158, 11, ${0.03 + warningProgress * 0.15})`,
      borderColor: `rgba(245, 158, 11, ${0.18 + warningProgress * 0.48})`
    };
  }
  return {};
};
