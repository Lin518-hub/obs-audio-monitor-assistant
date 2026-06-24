import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  BellOff,
  BookOpen,
  Check,
  ChevronDown,
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

document.body.dataset.route = route;
document.documentElement.dataset.route = route;

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
  const [showManual, setShowManual] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [thresholdDragging, setThresholdDragging] = useState(false);
  const pendingPatchRef = useRef<Partial<AppConfig>>({});
  const saveTimerRef = useRef<number | null>(null);
  const meterTrackRef = useRef<HTMLDivElement | null>(null);

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
  const updateThresholdFromClientX = (clientX: number) => {
    const rect = meterTrackRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    updateDraft('silenceThresholdDb', Math.round(percent * 85 - 90));
  };
  const beginThresholdDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setThresholdDragging(true);
    updateThresholdFromClientX(event.clientX);

    const onMove = (moveEvent: PointerEvent) => updateThresholdFromClientX(moveEvent.clientX);
    const onUp = () => {
      setThresholdDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <main className="app-shell">
      <div className="window-drag-strip" aria-hidden="true" />
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
            <div
              className={`meter-track ${thresholdDragging ? 'dragging' : ''}`}
              ref={meterTrackRef}
              onPointerDown={beginThresholdDrag}
            >
              <div className="meter-fill" style={{ width: `${levelPercent}%` }} />
              <div
                className="threshold-marker"
                role="slider"
                aria-label="静音阈值"
                aria-valuemin={-90}
                aria-valuemax={-5}
                aria-valuenow={Math.round(draft.silenceThresholdDb)}
                style={{ left: `${Math.max(0, Math.min(100, ((draft.silenceThresholdDb + 90) / 85) * 100))}%` }}
              >
                <span>{Math.round(draft.silenceThresholdDb)} dB</span>
              </div>
            </div>
          </div>
          <div className="status-cards">
            <Metric label="直播" value={snapshot.simulatedLive ? '模拟开播' : snapshot.streaming ? '进行中' : '未开始'} active={snapshot.streaming} />
            <Metric label="录制" value={snapshot.recording ? '进行中' : '未开始'} active={snapshot.recording} />
            <Metric
              label="静音计时"
              value={silenceMetricText(snapshot)}
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
          <div className="action-groups">
            <div className="action-group">
              <span>直播控制</span>
              <button className={snapshot.config.paused ? 'primary' : 'secondary'} onClick={() => void window.obsGuard.setPaused(!snapshot.config.paused)}>
                {snapshot.config.paused ? <Play size={18} /> : <Pause size={18} />}
                {snapshot.config.paused ? '恢复检测' : '暂停检测'}
              </button>
              <button className="secondary" onClick={() => void window.obsGuard.setFloatingWindowVisible(!snapshot.config.floatingWindowEnabled)}>
                <Monitor size={18} />
                {snapshot.config.floatingWindowEnabled ? '关闭小浮窗' : '打开小浮窗'}
              </button>
            </div>
            <div className="action-group">
              <span>连接维护</span>
              <button className="secondary" onClick={() => void window.obsGuard.reconnect()}>
                <RefreshCw size={18} />
                重连 OBS
              </button>
            </div>
          </div>
          <button className="diagnostic-toggle" onClick={() => setShowDiagnostics((value) => !value)}>
            <SlidersHorizontal size={17} />
            诊断与测试
            <ChevronDown size={16} className={showDiagnostics ? 'rotate' : ''} />
          </button>
          {showDiagnostics && (
            <div className="diagnostic-panel">
              <button className={snapshot.simulatedLive ? 'primary full' : 'ghost full'} onClick={() => void window.obsGuard.setSimulatedLive(!snapshot.simulatedLive)}>
                <Play size={17} />
                {snapshot.simulatedLive ? '关闭模拟开播' : '模拟开播检测'}
              </button>
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
              <button className="ghost full" onClick={() => setShowManual(true)}>
                <BookOpen size={17} />
                查看说明书
              </button>
              {testResult && <div className={`connection-result ${testResult.ok ? 'ok' : 'bad'}`}>{testResult.message}</div>}
            </div>
          )}
        </div>
      </section>

      <section className="settings-grid">
        <div className="panel">
          <div className="guide-target-block" data-guide="connection">
            <div className="panel-title">
              <Wifi size={18} />
              <span>OBS 连接</span>
            </div>
            <ConnectionNotice snapshot={snapshot} />
          </div>
          <div className="form-grid two" data-guide="connection-fields">
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
      {showManual && <ManualDialog onClose={() => setShowManual(false)} />}
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

  const tone = floatingTone(snapshot);
  const displayedSilent = displayedSilenceSeconds(snapshot);
  const isAudioNormal = audioStateKind(snapshot) === 'normal';
  const emphasis = floatingEmphasis(snapshot);
  const levelPercent = dbLevelPercent(snapshot.lastLevelDb);

  return (
    <main className={`floating-shell ${tone} ${theme} ${emphasis}`}>
      <div className="floating-ambient" />
      <header className="floating-header">
        <div className="floating-status">
          <span />
          <strong>{displayStatusText(snapshot)}</strong>
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
        <span>{isAudioNormal ? '检测中' : displayStatusText(snapshot)}</span>
        <strong>{isAudioNormal ? '正在讲话' : `${displayedSilent}s`}</strong>
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
        <span>{snapshot.simulatedLive ? '模拟开播' : snapshot.streaming ? '直播中' : snapshot.recording ? '录制中' : '未开播'}</span>
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
        <span>{snapshot.simulatedLive ? '模拟开播' : snapshot.streaming ? '直播中' : snapshot.recording ? '录制中' : '未开播'}</span>
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

type GuideLayout = {
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
  };
  card: {
    left: number;
    top: number;
  };
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

const overlapArea = (
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number }
) => {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
};

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
        title: '先看顶部状态',
        body: '这里是直播时最重要的地方。它会告诉你现在是 OBS 未连接、等待开播、检测中、静音预警，还是正在报警。你不需要猜软件有没有工作，先看这一块就够了。'
      },
      {
        target: 'connection',
        title: '第一步：打开 OBS 的 WebSocket',
        body: '先打开 OBS。然后在 OBS 顶部菜单点击“工具”，找到“WebSocket 服务器设置”。如果你看到“启用 WebSocket 服务器”，把它勾上。OBS 28 以后一般自带这个功能，不需要额外安装插件。'
      },
      {
        target: 'connection-fields',
        title: '第二步：填写端口和密码',
        body: 'OBS WebSocket 默认端口通常是 4455。如果 OBS 里面设置了服务器密码，就把同一个密码填到这里。主机一般保持 127.0.0.1。设置会自动保存，不需要点保存按钮。',
        action: 'test'
      },
      {
        target: 'actions',
        title: '第三步：先测试 OBS 是否连上',
        body: '打开“诊断与测试”，点击“测试 OBS 连接”。如果提示连接成功，就说明软件已经能读取 OBS 的输入源列表。如果失败，通常是 OBS 没开、WebSocket 没启用、端口不对或密码不一致。',
        action: 'openDiagnostics'
      },
      {
        target: 'source',
        title: '第四步：选择要守护的音源',
        body: '点击“目标音源”，选择真正会发出声音的来源。电商直播里通常选主播麦克风、无线领夹麦、声卡输入或直播主混音。图片、文字、显示器采集这类通常无声的来源会被过滤掉。'
      },
      {
        target: 'source',
        title: '第五步：设置报警规则',
        body: '默认连续静音 120 秒报警，前 90 秒会先出现小预警。你可以按直播间节奏调整时长：口播密集的直播间可以短一点，访谈或活动直播可以长一点。阈值一般保持默认 -55 dB。'
      },
      {
        target: 'actions',
        title: '第六步：不开播也能测试',
        body: '如果 OBS 已连接但还没正式开播，可以在“诊断与测试”里打开“模拟开播检测”。这样 OBS 没有推流时也能测试电平、静音计时和报警弹窗。测完记得关闭模拟开播。'
      },
      {
        target: 'actions',
        title: '第七步：直播中常用这几个按钮',
        body: '直播时外面只保留高频操作：暂停检测、打开小浮窗、重连 OBS。测试连接、刷新音源、模拟开播、测试报警都收在“诊断与测试”里，避免误触。'
      },
      {
        target: 'status',
        title: '最后：窗口关闭后仍在后台运行',
        body: '主窗口点关闭只是隐藏到后台，软件会继续检测。需要完全退出时，从系统托盘或菜单栏图标里选择“退出”。现在你可以开始按自己的 OBS 环境测试了。'
      }
    ],
    []
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [layout, setLayout] = useState<GuideLayout | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-guide]'));
    targets.forEach((target) => target.classList.remove('guide-active-target'));
    const target = document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`);
    let disposed = false;
    let raf = 0;
    const timers: number[] = [];

    const updateLayout = () => {
      if (disposed || !target) {
        setLayout(null);
        return;
      }

      const targetRect = target.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const margin = 24;
      const gap = 18;
      const padding = 8;
      const cardWidth = Math.min(cardRef.current?.offsetWidth || 430, viewportWidth - margin * 2);
      const cardHeight = Math.min(cardRef.current?.offsetHeight || 320, viewportHeight - margin * 2);
      const rect = {
        left: clamp(targetRect.left - padding, margin / 2, viewportWidth - margin / 2),
        top: clamp(targetRect.top - padding, margin / 2, viewportHeight - margin / 2),
        width: Math.min(targetRect.width + padding * 2, viewportWidth - margin),
        height: Math.min(targetRect.height + padding * 2, viewportHeight - margin),
        right: 0,
        bottom: 0
      };
      rect.right = Math.min(rect.left + rect.width, viewportWidth - margin / 2);
      rect.bottom = Math.min(rect.top + rect.height, viewportHeight - margin / 2);

      const cardBounds = (left: number, top: number) => ({
        left,
        top,
        right: left + cardWidth,
        bottom: top + cardHeight
      });
      const candidates = [
        {
          left: rect.right + gap,
          top: clamp(rect.top, margin, viewportHeight - cardHeight - margin),
          fits: rect.right + gap + cardWidth <= viewportWidth - margin
        },
        {
          left: rect.left - cardWidth - gap,
          top: clamp(rect.top, margin, viewportHeight - cardHeight - margin),
          fits: rect.left - cardWidth - gap >= margin
        },
        {
          left: clamp(rect.left, margin, viewportWidth - cardWidth - margin),
          top: rect.bottom + gap,
          fits: rect.bottom + gap + cardHeight <= viewportHeight - margin
        },
        {
          left: clamp(rect.left, margin, viewportWidth - cardWidth - margin),
          top: rect.top - cardHeight - gap,
          fits: rect.top - cardHeight - gap >= margin
        }
      ];
      const cleanCandidate = candidates.find((candidate) => candidate.fits);
      const fallback = candidates
        .map((candidate) => {
          const left = clamp(candidate.left, margin, viewportWidth - cardWidth - margin);
          const top = clamp(candidate.top, margin, viewportHeight - cardHeight - margin);
          return {
            left,
            top,
            score: overlapArea(rect, cardBounds(left, top))
          };
        })
        .sort((a, b) => a.score - b.score)[0];
      const card = cleanCandidate
        ? {
            left: clamp(cleanCandidate.left, margin, viewportWidth - cardWidth - margin),
            top: clamp(cleanCandidate.top, margin, viewportHeight - cardHeight - margin)
          }
        : {
            left: fallback.left,
            top: fallback.top
          };

      setLayout({ rect, card });
    };

    const scheduleLayout = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(updateLayout);
    };

    target?.classList.add('guide-active-target');
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    scheduleLayout();
    timers.push(window.setTimeout(updateLayout, 260));
    window.addEventListener('resize', scheduleLayout);
    window.addEventListener('scroll', scheduleLayout, true);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(raf);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener('resize', scheduleLayout);
      window.removeEventListener('scroll', scheduleLayout, true);
      targets.forEach((item) => item.classList.remove('guide-active-target'));
      target?.classList.remove('guide-active-target');
    };
  }, [step.target]);

  return (
    <div className="guide-overlay" role="dialog" aria-modal="true">
      {layout && (
        <div
          className="guide-spotlight"
          style={{
            left: layout.rect.left,
            top: layout.rect.top,
            width: layout.rect.right - layout.rect.left,
            height: layout.rect.bottom - layout.rect.top
          }}
        />
      )}
      <section ref={cardRef} className="guide-card" style={layout ? { left: layout.card.left, top: layout.card.top } : undefined}>
        <div className="guide-card-header">
          <div>
            <div className="eyebrow">New User Guide</div>
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
        {step.action === 'openDiagnostics' && (
          <div className="guide-test-inline">
            <span>提示：关闭引导后，在右侧快捷操作里展开“诊断与测试”。</span>
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

function ManualDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="manual-overlay" role="dialog" aria-modal="true">
      <section className="manual-dialog">
        <div className="manual-header">
          <div>
            <div className="eyebrow">User Manual</div>
            <h2>使用说明书</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭说明书">
            <X size={18} />
          </button>
        </div>
        <div className="manual-sections">
          <article>
            <strong>1. 在 OBS 里启用 WebSocket</strong>
            <p>打开 OBS，点击顶部菜单“工具”，进入“WebSocket 服务器设置”。勾选“启用 WebSocket 服务器”。默认端口通常是 4455，如果你在 OBS 里设置了服务器密码，就把同一个密码填到本软件里。</p>
          </article>
          <article>
            <strong>2. 连接并选择音源</strong>
            <p>主机通常保持 127.0.0.1。连接成功后，在“目标音源”里选择主播麦克风、无线领夹麦、声卡输入或直播主混音。图片、文字、显示器采集等通常无声来源会被过滤。</p>
          </article>
          <article>
            <strong>3. 设置静音报警规则</strong>
            <p>默认连续静音 120 秒报警，90 秒时先显示预警。电商直播可以根据口播密度调整时间，阈值一般保持 -55 dB 即可。</p>
          </article>
          <article>
            <strong>4. 不开播时测试</strong>
            <p>OBS 已连接但还没推流时，可以在“诊断与测试”里打开“模拟开播检测”。这样可以测试静音计时、小浮窗和报警弹窗。测完后关闭模拟开播。</p>
          </article>
          <article>
            <strong>5. 直播中怎么用</strong>
            <p>平时看顶部状态和小浮窗即可。需要临时调试时点“暂停检测”；需要常驻角落观察时打开“小浮窗”；连接异常时点“重连 OBS”。</p>
          </article>
        </div>
        <button className="primary manual-close" onClick={onClose}>
          <Check size={18} />
          我知道了
        </button>
      </section>
    </div>
  );
}

function safetyTitle(snapshot: AppSnapshot): string {
  if (snapshot.alertVisible) {
    return '正在报警';
  }

  if (snapshot.readinessReason === 'ready') {
    return audioStateKind(snapshot) === 'normal' ? '正在讲话' : '静音计时中';
  }

  return '尚未进入检测';
}

function readinessText(snapshot: AppSnapshot): string {
  const reasonText: Record<string, string> = {
    ready:
      audioStateKind(snapshot) === 'normal'
        ? '检测中，正在讲话，音频正常。'
        : `静音计时中，已静音 ${displayedSilenceSeconds(snapshot)} 秒，${secondsUntilVisibleAlert(snapshot)}s 后弹窗警告。`,
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
    ready: audioStateKind(snapshot) === 'normal' ? '音频正常，继续检测。' : `${secondsUntilVisibleAlert(snapshot)}s 后弹窗警告，请确认主播是否真的没有讲话。`,
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
      {displayStatusText(snapshot)}
    </div>
  );
}

function ConnectionNotice({ snapshot }: { snapshot: AppSnapshot }) {
  return (
    <div className={`connection-notice ${snapshot.connected ? 'connected' : 'disconnected'}`}>
      {snapshot.connected ? <Wifi size={17} /> : <WifiOff size={17} />}
      <div>
        <strong>{snapshot.connected ? 'OBS 已连接' : snapshot.status === 'connecting' ? '正在连接 OBS' : 'OBS 未连接'}</strong>
        <span>
          {snapshot.connected
            ? snapshot.simulatedLive
              ? '当前开启了模拟开播检测，可以在 OBS 未推流时测试静音逻辑。'
              : '已能读取 OBS 状态和可检测音频源。'
            : '请确认 OBS 已打开，并在 OBS 中启用 WebSocket 服务器。'}
        </span>
      </div>
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
    pre_alert: '静音计时中',
    alerting: '正在提醒',
    snoozed: '已延后检测',
    ignored_until_audio_returns: '本次已忽略',
    paused: '检测已暂停',
    error: '状态异常'
  };

  return labels[status] ?? status;
}

function displayStatusText(snapshot: AppSnapshot): string {
  if (audioStateKind(snapshot) === 'normal') {
    return '检测中';
  }

  if (audioStateKind(snapshot) === 'silent') {
    return '静音计时中';
  }

  return statusText(snapshot.status);
}

function silenceMetricText(snapshot: AppSnapshot): string {
  if (audioStateKind(snapshot) === 'normal') {
    return '正在讲话';
  }

  if (audioStateKind(snapshot) === 'silent') {
    return `${secondsUntilVisibleAlert(snapshot)}s 后弹窗警告`;
  }

  return statusText(snapshot.status);
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

function displayedSilenceSeconds(snapshot: AppSnapshot): number {
  if (snapshot.silentForSeconds < 3) {
    return 0;
  }

  return snapshot.silentForSeconds;
}

function audioStateKind(snapshot: AppSnapshot): 'normal' | 'silent' | 'other' {
  if (snapshot.readinessReason !== 'ready') {
    return 'other';
  }

  return displayedSilenceSeconds(snapshot) === 0 ? 'normal' : 'silent';
}

function secondsUntilVisibleAlert(snapshot: AppSnapshot): number {
  return Math.max(0, snapshot.config.silenceDurationSeconds - displayedSilenceSeconds(snapshot));
}

function floatingTone(snapshot: AppSnapshot): 'safe' | 'warning' | 'danger' | 'idle' {
  if (snapshot.alertVisible || (snapshot.secondsUntilAlert !== null && snapshot.secondsUntilAlert <= 10)) {
    return 'danger';
  }

  const displayedSilent = displayedSilenceSeconds(snapshot);
  if (snapshot.preAlertVisible || (displayedSilent >= 30 && displayedSilent % 30 < 5)) {
    return 'warning';
  }

  return snapshotTone(snapshot);
}

function floatingEmphasis(snapshot: AppSnapshot): string {
  if (snapshot.alertVisible || (snapshot.secondsUntilAlert !== null && snapshot.secondsUntilAlert <= 10)) {
    return 'critical-emphasis';
  }

  const displayedSilent = displayedSilenceSeconds(snapshot);
  if (snapshot.preAlertVisible || (displayedSilent >= 30 && displayedSilent % 30 < 5)) {
    return 'soft-emphasis';
  }

  return '';
}

function floatingHint(snapshot: AppSnapshot): string {
  if (snapshot.alertVisible) {
    return '已触发报警';
  }

  if (audioStateKind(snapshot) === 'normal') {
    return '音频正常';
  }

  if (audioStateKind(snapshot) === 'silent') {
    return `${secondsUntilVisibleAlert(snapshot)}s 后弹窗警告`;
  }

  return readinessText(snapshot);
}
