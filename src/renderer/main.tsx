import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  BellOff,
  Check,
  ChevronDown,
  CircleHelp,
  CircleDot,
  Clock3,
  History,
  Mic2,
  Monitor,
  Moon,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  TestTube2,
  Trash2,
  Volume2,
  Wifi,
  WifiOff,
  Wrench,
  X
} from 'lucide-react';
import type { AlertAction, AppConfig, AppSnapshot, InputOption, TestConnectionResult } from '../shared/types';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
const route =
  window.location.hash === '#alert'
    ? 'alert'
    : window.location.hash === '#prealert'
      ? 'prealert'
      : window.location.hash === '#floating'
        ? 'floating'
        : 'settings';

root.render(
  <React.StrictMode>
    {route === 'alert' ? <AlertApp /> : route === 'prealert' ? <PreAlertApp /> : route === 'floating' ? <FloatingApp /> : <SettingsApp />}
  </React.StrictMode>
);

function SettingsApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showGuide, setShowGuide] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const pendingPatchRef = useRef<Partial<AppConfig>>({});
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.obsGuard.getSnapshot().then((next) => {
      if (!mounted) {
        return;
      }
      setSnapshot(next);
      setDraft(next.config);
      setShowGuide(!next.config.hasSeenGuide);
    });

    const dispose = window.obsGuard.onSnapshot((next) => {
      setSnapshot(next);
      setDraft((current) => current ?? next.config);
    });

    return () => {
      mounted = false;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      dispose();
    };
  }, []);

  const levelPercent = useMemo(() => {
    if (snapshot?.lastLevelDb === null || snapshot?.lastLevelDb === undefined) {
      return 0;
    }

    return Math.max(0, Math.min(100, ((snapshot.lastLevelDb + 90) / 90) * 100));
  }, [snapshot?.lastLevelDb]);

  if (!snapshot || !draft) {
    return <div className="boot-screen">正在启动 OBS 音频检测助手...</div>;
  }

  const scheduleAutoSave = (patch: Partial<AppConfig>) => {
    pendingPatchRef.current = {
      ...pendingPatchRef.current,
      ...patch
    };
    setSaveState('saving');

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      const pending = pendingPatchRef.current;
      pendingPatchRef.current = {};
      saveTimerRef.current = null;

      void window.obsGuard
        .saveConfig(pending)
        .then((next) => {
          setSnapshot(next);
          setDraft((current) => (current ? { ...next.config, ...pendingPatchRef.current } : next.config));
          setSaveState('saved');
        })
        .catch(() => {
          setSaveState('error');
        });
    }, 420);
  };

  const closeGuide = async () => {
    setShowGuide(false);
    if (!snapshot.config.hasSeenGuide) {
      const next = await window.obsGuard.saveConfig({ hasSeenGuide: true });
      setSnapshot(next);
      setDraft(next.config);
    }
  };

  const testConnection = async () => {
    setTestingConnection(true);
    try {
      setTestResult(await window.obsGuard.testConnection(draft));
    } finally {
      setTestingConnection(false);
    }
  };

  const updateDraft = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    scheduleAutoSave({ [key]: value } as Partial<AppConfig>);
  };
  const hasMultipleDisplays = snapshot.displays.length > 1;

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <div className="eyebrow">OBS Audio Monitor Assistant</div>
          <h1>OBS 音频检测助手</h1>
        </div>
        <StatusPill snapshot={snapshot} />
      </section>

      <SafetyBanner snapshot={snapshot} />

      <section className="dashboard-grid">
        <div className="panel status-panel" data-guide="status">
          <div className="panel-title">
            <CircleDot size={18} />
            <span>实时检测</span>
          </div>
          <div className="meter-wrap">
            <div className="meter-header">
              <span>{draft.targetInputName || '未选择音源'}</span>
              <strong>{snapshot.lastLevelDb === null ? '--' : `${snapshot.lastLevelDb.toFixed(1)} dB`}</strong>
            </div>
            <div className="meter-track">
              <div className="meter-fill" style={{ width: `${levelPercent}%` }} />
              <div className="threshold-marker" style={{ left: `${Math.max(0, Math.min(100, ((draft.silenceThresholdDb + 90) / 90) * 100))}%` }} />
            </div>
          </div>
          <div className="status-cards">
            <Metric label="直播" value={snapshot.streaming ? '进行中' : '未开始'} active={snapshot.streaming} />
            <Metric label="录制" value={snapshot.recording ? '进行中' : '未开始'} active={snapshot.recording} />
            <Metric
              label="静音计时"
              value={snapshot.secondsUntilAlert === null ? `${snapshot.silentForSeconds}s` : `${snapshot.secondsUntilAlert}s 后报警`}
              active={snapshot.status === 'silent_counting'}
            />
          </div>
          {snapshot.errorMessage && <div className="inline-warning">{snapshot.errorMessage}</div>}
        </div>

        <div className="panel action-panel" data-guide="actions">
          <div className="panel-title">
            <Settings size={18} />
            <span>快捷操作</span>
          </div>
          <div className="action-stack">
            <button className={snapshot.config.paused ? 'primary' : 'secondary'} onClick={() => void window.obsGuard.setPaused(!snapshot.config.paused)}>
              {snapshot.config.paused ? <Play size={18} /> : <Pause size={18} />}
              {snapshot.config.paused ? '恢复检测' : '暂停检测'}
            </button>
            <button className="secondary" onClick={() => void window.obsGuard.setFloatingWindowVisible(!snapshot.config.floatingWindowEnabled)}>
              <Monitor size={18} />
              {snapshot.config.floatingWindowEnabled ? '关闭小浮窗' : '打开小浮窗'}
            </button>
            <button className="secondary" onClick={() => void window.obsGuard.reconnect()}>
              <RefreshCw size={18} />
              重连 OBS
            </button>
          </div>
          <button className="diagnostic-toggle" onClick={() => setShowDiagnostics((value) => !value)}>
            <Wrench size={17} />
            诊断与测试
            <ChevronDown size={16} className={showDiagnostics ? 'rotate' : ''} />
          </button>
          {showDiagnostics && (
            <div className="diagnostic-panel">
              <button className="ghost full" onClick={() => void testConnection()} disabled={testingConnection}>
                <TestTube2 size={17} />
                {testingConnection ? '测试中...' : '测试 OBS 连接'}
              </button>
              <button className="ghost full" onClick={() => void window.obsGuard.refreshInputs()}>
                <RefreshCw size={17} />
                刷新音源列表
              </button>
              <button className="ghost full" onClick={() => void window.obsGuard.testAlert()}>
                <AlertTriangle size={17} />
                测试报警弹窗
              </button>
              <button className="ghost full" onClick={() => setShowGuide(true)}>
                <CircleHelp size={17} />
                操作说明
              </button>
              {testResult && <div className={`connection-result ${testResult.ok ? 'ok' : 'bad'}`}>{testResult.message}</div>}
            </div>
          )}
        </div>
      </section>

      <section className="settings-grid">
        <div className="panel" data-guide="connection">
          <div className="panel-title">
            <Wifi size={18} />
            <span>OBS 连接</span>
          </div>
          <div className="form-grid two">
            <label>
              <span>主机</span>
              <input value={draft.obsHost} onChange={(event) => updateDraft('obsHost', event.target.value)} />
            </label>
            <label>
              <span>端口</span>
              <NumberControl
                value={draft.obsPort}
                min={1}
                max={65535}
                step={1}
                onChange={(value) => updateDraft('obsPort', value)}
              />
            </label>
            <label className="span-two">
              <span>WebSocket 密码</span>
              <input type="password" value={draft.obsPassword} onChange={(event) => updateDraft('obsPassword', event.target.value)} placeholder="未设置密码可留空" />
            </label>
          </div>
        </div>

        <div className="panel" data-guide="source">
          <div className="panel-title">
            <Volume2 size={18} />
            <span>检测规则</span>
          </div>
          <div className="form-grid two">
            <label className="span-two">
              <span>目标音源</span>
              <SourcePicker
                inputs={snapshot.inputs}
                value={draft.targetInputName}
                onChange={(value) => updateDraft('targetInputName', value)}
                onRefresh={() => void window.obsGuard.refreshInputs()}
              />
            </label>
            <label>
              <span>静音时长（秒）</span>
              <NumberControl
                value={draft.silenceDurationSeconds}
                min={5}
                max={3600}
                step={5}
                suffix="秒"
                onChange={(value) => updateDraft('silenceDurationSeconds', value)}
              />
            </label>
            <label>
              <span>静音阈值（dB）</span>
              <NumberControl
                value={draft.silenceThresholdDb}
                min={-90}
                max={-5}
                step={1}
                suffix="dB"
                onChange={(value) => updateDraft('silenceThresholdDb', value)}
              />
            </label>
          </div>
        </div>

        {hasMultipleDisplays && (
          <div className="panel span-two">
            <div className="panel-title">
              <Monitor size={18} />
              <span>报警窗口</span>
            </div>
            <div className="display-options">
              <Segment
                active={draft.alertDisplayMode === 'primary'}
                icon={<Monitor size={17} />}
                label="主屏中央"
                onClick={() => updateDraft('alertDisplayMode', 'primary')}
              />
              <Segment
                active={draft.alertDisplayMode === 'display_id'}
                icon={<Monitor size={17} />}
                label="指定屏幕"
                onClick={() => updateDraft('alertDisplayMode', 'display_id')}
              />
              <Segment
                active={draft.alertDisplayMode === 'all'}
                icon={<Radio size={17} />}
                label="所有屏幕"
                onClick={() => updateDraft('alertDisplayMode', 'all')}
              />
            </div>
            {draft.alertDisplayMode === 'display_id' && (
              <label className="display-picker">
                <span>弹出屏幕</span>
                <select value={draft.alertDisplayId ?? ''} onChange={(event) => updateDraft('alertDisplayId', event.target.value ? Number(event.target.value) : null)}>
                  <option value="">选择屏幕</option>
                  {snapshot.displays.map((display) => (
                    <option value={display.id} key={display.id}>
                      {display.label} - {display.bounds.width}x{display.bounds.height}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        <div className="panel span-two">
          <div className="panel-title history-title">
            <span>
              <History size={18} />
              <span>报警历史</span>
            </span>
            <button className="ghost mini" onClick={() => void window.obsGuard.clearHistory()}>
              <Trash2 size={15} />
              清空
            </button>
          </div>
          <HistoryList snapshot={snapshot} />
        </div>
      </section>

      <footer className="footer-actions">
        <div>设置会自动保存。默认仅在直播或录制中检测，OBS 空闲时不会报警。</div>
        <div className={`save-indicator ${saveState}`}>
          <span />
          {saveState === 'saving' ? '正在自动保存' : saveState === 'saved' ? '已自动保存' : saveState === 'error' ? '保存失败，请检查权限' : '等待设置变更'}
        </div>
      </footer>

      {showGuide && (
        <GuideDialog
          onClose={() => void closeGuide()}
          onTestConnection={() => void testConnection()}
          testResult={testResult}
          testingConnection={testingConnection}
        />
      )}
    </main>
  );
}

function AlertApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [closingAction, setClosingAction] = useState<AlertAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.obsGuard.getSnapshot().then(setSnapshot);
    return window.obsGuard.onSnapshot(setSnapshot);
  }, []);

  const sendAction = useCallback(
    async (action: AlertAction) => {
      if (closingAction) {
        return;
      }

      setClosingAction(action);
      setError(null);

      try {
        await window.obsGuard.alertAction(action);
      } catch (err) {
        setError('关闭失败，正在尝试强制关闭。');
        try {
          await window.obsGuard.forceCloseAlert();
        } catch {
          setError(err instanceof Error ? err.message : '关闭失败，请从托盘退出后重开。');
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

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sendAction]);

  if (!snapshot) {
    return null;
  }

  return (
    <main className="alert-shell">
      <div className="alert-icon">
        <AlertTriangle size={32} />
      </div>
      <section className="alert-copy">
        <div className="alert-kicker">音频静音提醒</div>
        <h1>{snapshot.config.targetInputName || '目标音源'} 可能没有声音</h1>
        <p>已连续静音 {snapshot.silentForSeconds} 秒，请确认麦克风是否静音、无线麦是否没电、声卡或 OBS 音频路由是否异常。</p>
      </section>
      <section className="alert-actions">
        <button className="quiet" onClick={() => void sendAction('ignore_once')} disabled={closingAction !== null}>
          <BellOff size={17} />
          {closingAction === 'ignore_once' ? '处理中...' : '单次忽略'}
        </button>
        <button className="confirm" onClick={() => void sendAction('acknowledge')} disabled={closingAction !== null}>
          <Check size={18} />
          {closingAction === 'acknowledge' ? '关闭中...' : '确定'}
        </button>
      </section>
      {error && <div className="alert-error">{error}</div>}
    </main>
  );
}

function PreAlertApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    void window.obsGuard.getSnapshot().then(setSnapshot);
    return window.obsGuard.onSnapshot(setSnapshot);
  }, []);

  if (!snapshot) {
    return null;
  }

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
      >
        ×
      </button>
      <div className="prealert-icon">
        <Clock3 size={24} />
      </div>
      <section>
        <div className="prealert-kicker">静音预警</div>
        <strong>{snapshot.config.targetInputName || '目标音源'} 已静音 {snapshot.silentForSeconds} 秒</strong>
        <p>约 {snapshot.preAlertRemainingSeconds ?? 0} 秒后触发正式报警</p>
      </section>
    </main>
  );
}

function FloatingApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('floatingTheme') === 'light' ? 'light' : 'dark'));

  useEffect(() => {
    void window.obsGuard.getSnapshot().then(setSnapshot);
    return window.obsGuard.onSnapshot(setSnapshot);
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem('floatingTheme', next);
      return next;
    });
  };

  if (!snapshot) {
    return null;
  }

  const tone = snapshotTone(snapshot);
  const levelPercent = dbLevelPercent(snapshot.lastLevelDb);

  return (
    <main className={`floating-shell ${tone} ${theme}`}>
      <header className="floating-header">
        <div className="floating-status">
          <span />
          <strong>{statusText(snapshot.status)}</strong>
        </div>
        <div className="floating-window-actions">
          <button aria-label={theme === 'dark' ? '切换浅色小浮窗' : '切换深色小浮窗'} onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button aria-label="打开设置" onClick={() => void window.obsGuard.showSettings()}>
            <Settings size={15} />
          </button>
          <button aria-label="关闭小浮窗" onClick={() => void window.obsGuard.setFloatingWindowVisible(false)}>
            ×
          </button>
        </div>
      </header>

      <section className="floating-time">
        <span>静音时间</span>
        <strong>{snapshot.silentForSeconds}s</strong>
        <em>{floatingHint(snapshot)}</em>
      </section>

      <section className="floating-meter">
        <div>
          <span>{snapshot.config.targetInputName || '未选择音源'}</span>
          <strong>{snapshot.lastLevelDb === null ? '--' : `${snapshot.lastLevelDb.toFixed(1)} dB`}</strong>
        </div>
        <div className="floating-meter-track">
          <div style={{ width: `${levelPercent}%` }} />
        </div>
      </section>

      <footer className="floating-footer">
        <span>{snapshot.streaming ? '直播中' : snapshot.recording ? '录制中' : '未开播'}</span>
        <button onClick={() => void window.obsGuard.setPaused(!snapshot.config.paused)}>
          {snapshot.config.paused ? <Play size={14} /> : <Pause size={14} />}
          {snapshot.config.paused ? '恢复' : '暂停'}
        </button>
      </footer>
    </main>
  );
}

function SafetyBanner({ snapshot }: { snapshot: AppSnapshot }) {
  const tone = snapshotTone(snapshot);

  return (
    <section className={`safety-banner ${tone}`}>
      <div className="safety-icon">
        {tone === 'safe' ? <ShieldCheck size={28} /> : tone === 'warning' ? <Clock3 size={28} /> : <AlertTriangle size={28} />}
      </div>
      <div>
        <div className="safety-label">{safetyTitle(snapshot)}</div>
        <p>{readinessText(snapshot)}</p>
        <strong className="safety-action">{readinessActionText(snapshot)}</strong>
      </div>
      <div className="safety-meta">
        <span>{snapshot.streaming ? '直播中' : snapshot.recording ? '录制中' : '未开播'}</span>
        <strong>{snapshot.config.targetInputName || '未选择音源'}</strong>
      </div>
    </section>
  );
}

function HistoryList({ snapshot }: { snapshot: AppSnapshot }) {
  if (snapshot.history.length === 0) {
    return <div className="empty-history">暂无报警记录</div>;
  }

  return (
    <div className="history-list">
      {snapshot.history.map((entry) => (
        <div className="history-item" key={entry.id}>
          <div>
            <strong>{entry.inputName}</strong>
            <span>{new Date(entry.timestamp).toLocaleString()}</span>
          </div>
          <div>
            <strong>{entry.silentForSeconds}s</strong>
            <span>{entry.action === 'acknowledge' ? '确定' : '单次忽略'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function GuideDialog({
  onClose,
  onTestConnection,
  testResult,
  testingConnection
}: {
  onClose: () => void;
  onTestConnection: () => void;
  testResult: TestConnectionResult | null;
  testingConnection: boolean;
}) {
  const steps = useMemo(
    () => [
      {
        target: 'status',
        title: '先看当前是否安全',
        body: '这里会直接告诉你 OBS 是否连接、是否开播、目标音源是否有电平。直播中只要看这一块，就能判断麦克风是否正常。',
        action: null
      },
      {
        target: 'connection',
        title: '连接 OBS WebSocket',
        body: 'OBS 里打开“工具”到“WebSocket 服务器设置”，默认端口通常是 4455。有密码就填同一个密码，软件会自动保存。',
        action: 'test'
      },
      {
        target: 'source',
        title: '只选择可能有声音的音源',
        body: '这里会过滤图片、文字、显示器采集等通常没有声音的来源。电商直播建议选择主播麦克风、无线领夹麦、声卡输入或直播主混音。',
        action: null
      },
      {
        target: 'actions',
        title: '高频操作留在外面',
        body: '直播中常用的是暂停检测、打开小浮窗、重连 OBS。测试报警、刷新音源和操作说明已经收进“诊断与测试”。',
        action: null
      }
    ],
    []
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<DOMRect | null>(null);
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  useEffect(() => {
    const updateSpotlight = () => {
      const target = document.querySelector(`[data-guide="${step.target}"]`);
      if (!target) {
        setSpotlight(null);
        return;
      }

      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      window.setTimeout(() => {
        setSpotlight(target.getBoundingClientRect());
      }, 180);
    };

    updateSpotlight();
    window.addEventListener('resize', updateSpotlight);
    return () => window.removeEventListener('resize', updateSpotlight);
  }, [step.target]);

  const cardStyle = spotlight
    ? {
        left: Math.min(window.innerWidth - 380, Math.max(24, spotlight.right + 18)),
        top: Math.min(window.innerHeight - 280, Math.max(24, spotlight.top))
      }
    : undefined;

  return (
    <div className="guide-overlay" role="dialog" aria-modal="true">
      {spotlight && (
        <div
          className="guide-spotlight"
          style={{
            left: spotlight.left - 8,
            top: spotlight.top - 8,
            width: spotlight.width + 16,
            height: spotlight.height + 16
          }}
        />
      )}
      <section className="guide-card" style={cardStyle}>
        <div className="guide-card-header">
          <div>
            <div className="eyebrow">Setup Guide</div>
            <h2>{step.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="跳过操作说明">
            <X size={18} />
          </button>
        </div>
        <p>{step.body}</p>
        {step.action === 'test' && (
          <div className="guide-test-inline">
            <button className="secondary" onClick={onTestConnection} disabled={testingConnection}>
              <TestTube2 size={17} />
              {testingConnection ? '测试中...' : '测试 OBS 连接'}
            </button>
            {testResult && <span className={testResult.ok ? 'test-ok' : 'test-bad'}>{testResult.message}</span>}
          </div>
        )}
        <div className="guide-progress">
          <span>
            {stepIndex + 1} / {steps.length}
          </span>
          <div>
            <button className="ghost mini" onClick={onClose}>
              跳过
            </button>
            <button className="primary" onClick={() => (isLastStep ? onClose() : setStepIndex((index) => index + 1))}>
              {isLastStep ? '完成' : '下一步'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function safetyTitle(snapshot: AppSnapshot): string {
  if (snapshot.alertVisible) {
    return '正在报警';
  }

  if (snapshot.preAlertVisible) {
    return '静音预警中';
  }

  if (snapshot.readinessReason === 'ready') {
    return '当前安全';
  }

  return '尚未进入检测';
}

function readinessText(snapshot: AppSnapshot): string {
  const reasonText: Record<string, string> = {
    ready: snapshot.secondsUntilAlert === null ? '音源电平正常，正在守护直播间麦克风和主音频。' : `已静音 ${snapshot.silentForSeconds} 秒，距离报警 ${snapshot.secondsUntilAlert} 秒。`,
    obs_disconnected: 'OBS 未连接，请确认 OBS 已打开且 WebSocket 已启用。',
    obs_connecting: '正在连接 OBS WebSocket。',
    not_streaming_or_recording: 'OBS 当前未直播或录制，暂不检测。',
    no_target_selected: '请选择需要监听的 OBS 音频源。',
    target_missing: '目标音源不在 OBS 输入源列表中，请刷新或重新选择。',
    no_target_meter: '暂时没有收到目标音源电平数据，请确认该源处于活动状态。',
    paused: '检测已手动暂停。',
    snoozed: snapshot.snoozedUntil ? `已延后检测，将在 ${new Date(snapshot.snoozedUntil).toLocaleTimeString()} 后恢复。` : '已延后检测。',
    alerting: '目标音源静音超时，请处理报警弹窗。',
    error: snapshot.errorMessage ?? '检测状态异常。'
  };

  return reasonText[snapshot.readinessReason] ?? '正在读取状态。';
}

function readinessActionText(snapshot: AppSnapshot): string {
  const actionText: Record<string, string> = {
    ready: snapshot.secondsUntilAlert === null ? '无需操作，保持监听。' : '观察预警倒计时，确认主播是否正在正常停顿。',
    obs_disconnected: '下一步：打开 OBS，并确认 WebSocket 服务已启用。',
    obs_connecting: '正在自动连接，必要时点击“重连 OBS”。',
    not_streaming_or_recording: '开播或开始录制后会自动进入检测。',
    no_target_selected: '下一步：在“检测规则”里选择主播麦克风或直播主混音。',
    target_missing: '下一步：刷新音源列表，或在 OBS 中恢复这个音源。',
    no_target_meter: '下一步：确认该源在当前场景中处于活动状态。',
    paused: '需要恢复时点击右侧“恢复检测”。',
    snoozed: '忽略倒计时结束后会自动恢复检测。',
    alerting: '请处理报警弹窗中的“确定”或“单次忽略”。',
    error: '请查看错误信息，必要时重连 OBS。'
  };

  return actionText[snapshot.readinessReason] ?? '等待状态更新。';
}

function StatusPill({ snapshot }: { snapshot: AppSnapshot }) {
  const connected = snapshot.connected;
  return (
    <div className={`status-pill ${connected ? 'online' : 'offline'}`}>
      {connected ? <Wifi size={17} /> : <WifiOff size={17} />}
      {statusText(snapshot.status)}
    </div>
  );
}

function Metric({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className={`metric ${active ? 'active' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SourcePicker({
  inputs,
  value,
  onChange,
  onRefresh
}: {
  inputs: InputOption[];
  value: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const selected = inputs.find((input) => input.inputName === value);
  const filteredInputs = inputs.filter((input) => input.inputName.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="source-picker" ref={pickerRef}>
      <button className={`source-trigger ${open ? 'open' : ''}`} onClick={() => setOpen((next) => !next)}>
        <span className="source-trigger-icon">
          <Mic2 size={18} />
        </span>
        <span className="source-trigger-copy">
          <strong>{selected?.inputName || value || '选择可能有声音的 OBS 音源'}</strong>
          <em>{selected ? readableInputKind(selected.inputKind) : inputs.length > 0 ? `${inputs.length} 个可检测音源` : '请先连接 OBS 或刷新音源'}</em>
        </span>
        <ChevronDown size={18} className={open ? 'rotate' : ''} />
      </button>

      {open && (
        <div className="source-menu">
          <div className="source-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索麦克风、声卡、主混音" autoFocus />
          </div>
          <div className="source-list">
            {filteredInputs.length === 0 ? (
              <div className="source-empty">
                <strong>没有可选音频源</strong>
                <span>已过滤图片、文字、显示器采集等通常无声音的来源。请确认 OBS 中有麦克风、声卡、媒体或主混音。</span>
              </div>
            ) : (
              filteredInputs.map((input) => (
                <button
                  className={`source-option ${input.inputName === value ? 'active' : ''}`}
                  key={`${input.inputKind}:${input.inputName}`}
                  onClick={() => {
                    onChange(input.inputName);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <Mic2 size={17} />
                  <span>
                    <strong>{input.inputName}</strong>
                    <em>{readableInputKind(input.inputKind)}</em>
                  </span>
                  {input.inputName === value && <Check size={17} />}
                </button>
              ))
            )}
          </div>
          <button className="source-refresh" onClick={onRefresh}>
            <RefreshCw size={16} />
            重新读取 OBS 音源
          </button>
        </div>
      )}
    </div>
  );
}

function NumberControl({
  value,
  min,
  max,
  step,
  suffix,
  onChange
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : value;
    setText(String(next));
    if (next !== value) {
      onChange(next);
    }
  };

  const stepBy = (direction: -1 | 1) => {
    const next = Math.min(max, Math.max(min, value + step * direction));
    setText(String(next));
    onChange(next);
  };

  return (
    <div className="number-control">
      <button type="button" onClick={() => stepBy(-1)} aria-label="减少数值">
        -
      </button>
      <div className="number-field">
        <input
          inputMode="numeric"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => commit(text)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit(text);
            }
          }}
        />
        {suffix && <span>{suffix}</span>}
      </div>
      <button type="button" onClick={() => stepBy(1)} aria-label="增加数值">
        +
      </button>
    </div>
  );
}

function Segment({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`segment ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
    disconnected: 'OBS 未连接',
    connecting: '正在连接 OBS',
    idle_not_streaming: '等待直播/录制',
    monitoring: '检测中',
    silent_counting: '静音计时中',
    pre_alert: '静音预警中',
    alerting: '正在提醒',
    snoozed: '已延后检测',
    ignored_until_audio_returns: '本次已忽略',
    paused: '检测已暂停',
    error: '状态异常'
  };

  return labels[status] ?? status;
}

function dbLevelPercent(levelDb: number | null): number {
  if (levelDb === null) {
    return 0;
  }

  return Math.max(0, Math.min(100, ((levelDb + 90) / 90) * 100));
}

function readableInputKind(inputKind: string): string {
  if (inputKind.includes('wasapi') || inputKind.includes('coreaudio') || inputKind.includes('pulse') || inputKind.includes('alsa')) {
    return '系统音频 / 麦克风';
  }

  if (inputKind.includes('media') || inputKind.includes('ffmpeg') || inputKind.includes('vlc')) {
    return '媒体源';
  }

  if (inputKind.includes('browser')) {
    return '浏览器源';
  }

  if (inputKind.includes('dshow') || inputKind.includes('capture')) {
    return '采集设备';
  }

  if (inputKind === 'demo_input') {
    return '演示音源';
  }

  return inputKind || 'OBS 输入源';
}

function snapshotTone(snapshot: AppSnapshot): 'safe' | 'warning' | 'danger' | 'idle' {
  if (snapshot.alertVisible) {
    return 'danger';
  }

  if (snapshot.preAlertVisible) {
    return 'warning';
  }

  return snapshot.readinessReason === 'ready' ? 'safe' : 'idle';
}

function floatingHint(snapshot: AppSnapshot): string {
  if (snapshot.alertVisible) {
    return '已触发报警';
  }

  if (snapshot.secondsUntilAlert !== null) {
    return `${snapshot.secondsUntilAlert}s 后报警`;
  }

  if (snapshot.readinessReason === 'ready') {
    return '音频正常';
  }

  return readinessText(snapshot);
}
